'use strict';

const ACCESS_LEVELS=Object.freeze(['public','sample','knowledge']);
const SECTION_TYPES=Object.freeze([
  'paragraph','heading','subheading','quote','highlight','list','table',
  'exercise','exercise_black','checklist','chapter_checklist','rule_black',
  'impact_phrase','separator','transition','callout','example','warning','image'
]);
const PUBLICATION_TYPES=Object.freeze(['book','course','material','exercise_collection']);
const METADATA_KEYS=Object.freeze([
  'variant','label','credit','layout','difficulty','locale','component_type',
  'source_scope','source_page','editorial_role','source_hash'
]);
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256=/^[0-9a-f]{64}$/;

function fail(path,message){throw new TypeError(`${path}: ${message}`)}
function object(value,path){if(!value||typeof value!=='object'||Array.isArray(value))fail(path,'expected object');return value}
function text(value,path,{optional=false,max=10000}={}){
  if(optional&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||!value.trim())fail(path,'expected non-empty text');
  if(value.length>max)fail(path,`exceeds ${max} characters`);
  return value.trim();
}
function positiveInteger(value,path){if(!Number.isInteger(value)||value<1)fail(path,'expected positive integer');return value}
function access(value,path){if(!ACCESS_LEVELS.includes(value))fail(path,'invalid access level');return value}
function unique(values,path){if(new Set(values).size!==values.length)fail(path,'duplicate value');}
function metadata(value,path){
  const source=value===undefined?{}:object(value,path),keys=Object.keys(source);
  keys.forEach(key=>{if(!METADATA_KEYS.includes(key))fail(`${path}.${key}`,'unsupported metadata key')});
  if(source.source_page!==undefined)positiveInteger(source.source_page,`${path}.source_page`);
  if(source.source_hash!==undefined&&(!SHA256.test(source.source_hash)))fail(`${path}.source_hash`,'expected SHA-256');
  ['variant','label','credit','layout','difficulty','locale','component_type','source_scope','editorial_role'].forEach(key=>{
    if(source[key]!==undefined)text(source[key],`${path}.${key}`,{max:200});
  });
  return source;
}

function validateSectionContent(section,path){
  const content=object(section.content,`${path}.content`);
  if(Object.prototype.hasOwnProperty.call(content,'html'))fail(`${path}.content`,'arbitrary HTML is forbidden');
  if(!SECTION_TYPES.includes(section.section_type))fail(`${path}.section_type`,'unsupported section type');
  const type=section.section_type;
  if(['paragraph','heading','subheading','quote','highlight','warning','rule_black','impact_phrase','transition','callout'].includes(type))text(content.text,`${path}.content.text`);
  if(['list','checklist','chapter_checklist'].includes(type)){
    if(!Array.isArray(content.items)||!content.items.length)fail(`${path}.content.items`,'expected non-empty array');
    content.items.forEach((item,index)=>text(item,`${path}.content.items[${index}]`));
  }
  if(type==='table'){
    if(!Array.isArray(content.columns)||!content.columns.length)fail(`${path}.content.columns`,'expected non-empty array');
    if(!Array.isArray(content.rows))fail(`${path}.content.rows`,'expected array');
    content.columns.forEach((item,index)=>text(item,`${path}.content.columns[${index}]`));
    content.rows.forEach((row,rowIndex)=>{
      if(!Array.isArray(row)||row.length!==content.columns.length)fail(`${path}.content.rows[${rowIndex}]`,'column count differs');
      row.forEach((cell,columnIndex)=>{
        if(typeof cell!=='string')fail(`${path}.content.rows[${rowIndex}][${columnIndex}]`,'expected text');
        if(cell.length>10000)fail(`${path}.content.rows[${rowIndex}][${columnIndex}]`,'exceeds 10000 characters');
      });
    });
  }
  if(['exercise','exercise_black','example'].includes(type)){
    text(content.prompt,`${path}.content.prompt`);
    if(content.steps!==undefined){
      if(!Array.isArray(content.steps))fail(`${path}.content.steps`,'expected array');
      content.steps.forEach((item,index)=>text(item,`${path}.content.steps[${index}]`));
    }
  }
  if(type==='image'){
    const asset=text(content.asset_path,`${path}.content.asset_path`);
    text(content.alt,`${path}.content.alt`);
    if(!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(asset)||/(^|\/)\.\.(\/|$)/.test(asset)||/^[A-Za-z]+:/.test(asset))fail(`${path}.content.asset_path`,'unsafe asset path');
  }
  if(type==='separator'&&Object.keys(content).length)fail(`${path}.content`,'separator content must be empty');
  return {...section,position:positiveInteger(section.position,`${path}.position`),access_level:access(section.access_level,`${path}.access_level`),content,metadata:metadata(section.metadata,`${path}.metadata`)};
}

function validateKnowledgeDocument(input){
  const document=object(input,'document');
  const publication=object(document.publication,'publication');
  const editorial=object(document.editorial_metadata,'editorial_metadata');
  ['publication_version','content_version','structure_version'].forEach(key=>text(editorial[key],`editorial_metadata.${key}`,{max:100}));
  if(!SHA256.test(editorial.source_hash||''))fail('editorial_metadata.source_hash','expected SHA-256');
  if(typeof editorial.converted_at!=='string'||!Number.isFinite(Date.parse(editorial.converted_at)))fail('editorial_metadata.converted_at','expected ISO timestamp');
  const slug=text(publication.slug,'publication.slug',{max:100});
  if(!SLUG.test(slug))fail('publication.slug','invalid slug');
  if(!PUBLICATION_TYPES.includes(publication.publication_type||'book'))fail('publication.publication_type','unsupported type');
  if(!Array.isArray(document.parts)||!document.parts.length)fail('parts','expected non-empty array');
  const normalizedParts=document.parts.map((part,partIndex)=>{
    const path=`parts[${partIndex}]`,source=object(part,path);
    if(!Array.isArray(source.chapters)||!source.chapters.length)fail(`${path}.chapters`,'expected non-empty array');
    const chapters=source.chapters.map((chapter,chapterIndex)=>{
      const chapterPath=`${path}.chapters[${chapterIndex}]`,chapterSource=object(chapter,chapterPath);
      const chapterSlug=text(chapterSource.slug,`${chapterPath}.slug`,{max:100});
      if(!SLUG.test(chapterSlug))fail(`${chapterPath}.slug`,'invalid slug');
      if(!Array.isArray(chapterSource.sections)||!chapterSource.sections.length)fail(`${chapterPath}.sections`,'expected non-empty array');
      const sections=chapterSource.sections.map((section,sectionIndex)=>validateSectionContent(object(section,`${chapterPath}.sections[${sectionIndex}]`),`${chapterPath}.sections[${sectionIndex}]`));
      unique(sections.map(item=>item.position),`${chapterPath}.sections.position`);
      return {...chapterSource,slug:chapterSlug,position:positiveInteger(chapterSource.position,`${chapterPath}.position`),title:text(chapterSource.title,`${chapterPath}.title`),subtitle:text(chapterSource.subtitle,`${chapterPath}.subtitle`,{optional:true}),excerpt:text(chapterSource.excerpt,`${chapterPath}.excerpt`,{optional:true}),access_level:access(chapterSource.access_level,`${chapterPath}.access_level`),estimated_read_minutes:positiveInteger(chapterSource.estimated_read_minutes||1,`${chapterPath}.estimated_read_minutes`),sections};
    });
    unique(chapters.map(item=>item.position),`${path}.chapters.position`);
    unique(chapters.map(item=>item.slug),`${path}.chapters.slug`);
    return {...source,position:positiveInteger(source.position,`${path}.position`),title:text(source.title,`${path}.title`),chapters};
  });
  unique(normalizedParts.map(item=>item.position),'parts.position');
  unique(normalizedParts.flatMap(part=>part.chapters.map(chapter=>chapter.slug)),'chapters.slug');
  return Object.freeze({
    publication:Object.freeze({...publication,slug,title:text(publication.title,'publication.title'),subtitle:text(publication.subtitle,'publication.subtitle',{optional:true}),description:text(publication.description,'publication.description',{optional:true}),author:text(publication.author,'publication.author',{optional:true}),publication_type:publication.publication_type||'book',version:text(publication.version||'1.0','publication.version'),status:publication.status||'draft'}),
    parts:normalizedParts,
    editorial_metadata:Object.freeze({...editorial})
  });
}

const api={ACCESS_LEVELS,SECTION_TYPES,PUBLICATION_TYPES,METADATA_KEYS,validateKnowledgeDocument};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBKnowledgeImport=Object.freeze(api);
