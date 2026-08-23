'use strict';

const ACCESS_LEVELS=Object.freeze(['public','sample','knowledge']);
const SECTION_TYPES=Object.freeze(['paragraph','heading','quote','highlight','list','table','exercise','warning','image','separator']);
const PUBLICATION_TYPES=Object.freeze(['book','course','material','exercise_collection']);
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function validateSectionContent(section,path){
  const content=object(section.content,`${path}.content`);
  if(Object.prototype.hasOwnProperty.call(content,'html'))fail(`${path}.content`,'arbitrary HTML is forbidden');
  if(!SECTION_TYPES.includes(section.section_type))fail(`${path}.section_type`,'unsupported section type');
  const type=section.section_type;
  if(['paragraph','heading','quote','highlight','warning'].includes(type))text(content.text,`${path}.content.text`);
  if(type==='list'){
    if(!Array.isArray(content.items)||!content.items.length)fail(`${path}.content.items`,'expected non-empty array');
    content.items.forEach((item,index)=>text(item,`${path}.content.items[${index}]`));
  }
  if(type==='table'){
    if(!Array.isArray(content.columns)||!content.columns.length)fail(`${path}.content.columns`,'expected non-empty array');
    if(!Array.isArray(content.rows))fail(`${path}.content.rows`,'expected array');
    content.columns.forEach((item,index)=>text(item,`${path}.content.columns[${index}]`));
    content.rows.forEach((row,rowIndex)=>{
      if(!Array.isArray(row)||row.length!==content.columns.length)fail(`${path}.content.rows[${rowIndex}]`,'column count differs');
      row.forEach((cell,columnIndex)=>text(String(cell),`${path}.content.rows[${rowIndex}][${columnIndex}]`));
    });
  }
  if(type==='exercise'){
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
  return {...section,position:positiveInteger(section.position,`${path}.position`),access_level:access(section.access_level,`${path}.access_level`),content};
}

function validateKnowledgeDocument(input){
  const document=object(input,'document');
  const publication=object(document.publication,'publication');
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
    parts:normalizedParts
  });
}

const api={ACCESS_LEVELS,SECTION_TYPES,PUBLICATION_TYPES,validateKnowledgeDocument};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBKnowledgeImport=Object.freeze(api);
