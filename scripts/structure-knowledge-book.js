#!/usr/bin/env node
'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');

const EXPECTED_PARTS=Object.freeze([
  {position:1,title:'Mentalidade e Comportamento Financeiro',chapters:[1,8]},
  {position:2,title:'Organização Financeira',chapters:[9,14]},
  {position:3,title:'Cartão de Crédito',chapters:[15,20]},
  {position:4,title:'Reserva de Emergência e Segurança',chapters:[21,26]}
]);
const EDITORIAL_TERMS=Object.freeze([
  {label:'Black 8',pattern:/\bBlack\s*8\b/giu,suggestion:'Revisar compatibilidade com a nomenclatura oficial Black 6.'},
  {label:'Grandes Projetos',pattern:/\bGrandes\s+Projetos\b/giu,suggestion:'Revisar a nomenclatura editorial antes da publicação.'},
  {label:'Liberdade Financeira',pattern:/\bLiberdade\s+Financeira\b/giu,suggestion:'Confirmar se o termo permanece canônico na edição atual.'},
  {label:'Pequenos Imprevistos',pattern:/\bPequenos\s+Imprevistos\b/giu,suggestion:'Confirmar se ainda deve ser tratado como categoria do sistema.'},
  {label:'Método Black',pattern:/\bM[ée]todo\s+Black\b/giu,suggestion:'Padronizar com Sistema Black 6 ou Mentoria Black conforme o contexto editorial.'},
  {label:'Sistema Black 6',pattern:/\bSistema\s+Black\s*6\b/giu,suggestion:'Confirmar padronização de grafia e capitalização em toda a obra.'},
  {label:'duas cartas',pattern:/\bduas\s+cartas\b/giu,suggestion:'Revisar para “dois cartões” quando o contexto for cartão de crédito.'}
]);

function fail(message){throw new Error(message)}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex')}
function normalize(value){return String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function fold(value){return normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function slugify(value){
  return normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
}
function parseArgs(argv){
  const options={mode:'write'};
  for(let i=2;i<argv.length;i+=1){
    const arg=argv[i];
    if(arg==='--validate-only')options.mode='validate-only';
    else if(arg==='--dry-run')options.mode='dry-run';
    else if(arg.startsWith('--')){
      const key=arg.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
      const value=argv[++i];
      if(!value||value.startsWith('--'))fail(`${arg} requires a value`);
      options[key]=value;
    }else fail(`unexpected argument: ${arg}`);
  }
  return options;
}
function assertProtectedPath(target,label){
  const resolved=path.resolve(target),root=path.resolve('.local-content');
  if(resolved!==root&&!resolved.startsWith(`${root}${path.sep}`))fail(`${label} must be inside .local-content`);
  return resolved;
}

function sourceEntries(raw){
  const entries=[];
  raw.split('\f').forEach((page,pageIndex)=>{
    page.split(/\r?\n/).forEach((rawLine,lineIndex)=>{
      const trimmed=rawLine.trim();
      let text=normalize(trimmed.replace(/\(cid:127\)/g,'•'));
      if(text==='n')text='•';
      else if(/^n\s+\S/u.test(text))text=`• ${text.slice(2)}`;
      entries.push({page:pageIndex+1,line:lineIndex+1,raw:trimmed,text,blank:!text});
    });
    entries.push({page:pageIndex+1,line:9999,raw:'',text:'',blank:true,pageBreak:true});
  });
  return entries;
}
function marker(entry){
  let match=entry.text.match(/^PARTE\s+([1-4])\s*[—-]\s*(.+)$/iu);
  if(match)return {kind:'part',number:Number(match[1]),title:normalize(match[2])};
  match=entry.text.match(/^CAP[IÍ]TULO\s+(\d{1,2})(?:\s*[—-]\s*(.+))?$/iu);
  if(match)return {kind:'chapter',number:Number(match[1]),title:normalize(match[2]||'')};
  return null;
}
function selectedMarkers(entries){
  const parts=new Map(),chapters=new Map(),allParts=[];
  entries.forEach((entry,index)=>{
    const found=marker(entry);
    if(!found)return;
    const value={...found,index,page:entry.page};
    if(found.kind==='part'){parts.set(found.number,value);allParts.push(value)}
    else chapters.set(found.number,value);
  });
  EXPECTED_PARTS.forEach(part=>{
    if(!parts.has(part.position))fail(`missing part ${part.position}`);
    for(let number=part.chapters[0];number<=part.chapters[1];number+=1){
      if(!chapters.has(number))fail(`missing chapter ${number}`);
    }
  });
  return {parts,chapters,allParts};
}
function uppercaseTitle(value){
  const letters=value.replace(/[^A-Za-zÀ-ÿ]/g,'');
  return letters.length>2&&value===value.toUpperCase()&&!/^\d+[.)]/.test(value);
}
function consumeTitle(entries,start,inlineTitle,end){
  const pieces=inlineTitle?[inlineTitle]:[];
  let index=start;
  while(index<end&&entries[index].blank)index+=1;
  while(index<end&&uppercaseTitle(entries[index].text)&&!marker(entries[index])){
    pieces.push(entries[index].text);
    index+=1;
    while(index<end&&entries[index].blank)index+=1;
  }
  if(!pieces.length)fail(`chapter title missing near source page ${entries[start]?.page||'unknown'}`);
  return {title:normalize(pieces.join(' ')),bodyStart:index};
}
function headingDescriptor(value){
  const stripped=normalize(value).replace(/^\d+\.\s*/,'');
  const normalized=fold(stripped);
  if(/^CHECKLIST(?:\s+DO\s+CAPITULO)?/.test(normalized))return {type:'chapter_checklist',label:stripped,role:'checklist'};
  if(/^EXERCICIO\s+BLACK/.test(normalized))return {type:'exercise_black',label:stripped,role:'exercise'};
  if(/^EXERCICIO/.test(normalized))return {type:'exercise',label:stripped,role:'exercise'};
  if(/^REGRA\s+BLACK/.test(normalized))return {type:'rule_black',label:stripped,role:'rule'};
  if(/^FRASE\s+DE\s+IMPACTO/.test(normalized))return {type:'impact_phrase',label:stripped,role:'impact'};
  if(/^EXEMPLO\s+PRATICO/.test(normalized))return {type:'example',label:stripped,role:'example'};
  if(/^MINHA\s+EXPERIENCIA/.test(normalized))return {type:'callout',label:stripped,role:'experience'};
  if(/^CONCLUSAO/.test(normalized))return {type:'callout',label:stripped,role:'conclusion'};
  if(/\bTRANSICAO\b/.test(normalized))return {type:'transition',label:stripped,role:'transition'};
  if(/^O\s+QUE\s+EU\s+(QUERO\s+ENSINAR|APRENDI|PENSO\s+SOBRE\s+ISSO)/.test(normalized))return {type:'subheading',label:stripped,role:'editorial_prompt'};
  if(/^\d+\.\s+/.test(value))return {type:'subheading',label:stripped,role:'section_heading'};
  return null;
}
function isBullet(value){return /^•(?:\s+|$)|^[-▪✓☐]\s+/.test(value)}
function bulletText(value){return normalize(value.replace(/^(?:•|[-▪✓☐])\s*/,''))}
function sourceHashFor(type,content){return hash(JSON.stringify({type,content}))}
function componentTypeFor(type,content){
  const normalized=fold(JSON.stringify(content));
  if(/SISTEMA\s+BLACK\s*6/.test(normalized))return 'system_black_6';
  if(/CAMADAS?\s+DE\s+SEGURANCA/.test(normalized))return 'security_layers';
  if(/DEPENDENCIA/.test(normalized)&&/CONSCIENCIA/.test(normalized)&&/CARTAO\s+LASTREADO/.test(normalized))return 'financial_evolution_path';
  if(/PLANEJADO\s*X\s*REALIZADO|COMPARACAO\s+DE\s+CENARIO|CENARIO\s+[0-9A-Z]/.test(normalized))return 'scenario_comparison';
  if(['exercise','exercise_black'].includes(type)&&/FINAL/.test(normalized))return 'final_exercise';
  return null;
}
function section(type,content,accessLevel,entry,extra={}){
  const componentType=componentTypeFor(type,content);
  const metadata={source_page:entry.page,source_hash:sourceHashFor(type,content),...(componentType?{component_type:componentType}:{}),...extra};
  return {position:0,section_type:type,content,metadata,access_level:accessLevel};
}

function sectionize(entries,accessLevel,scope){
  const output=[];
  let paragraph=[],paragraphEntry=null,bullets=[],bulletEntry=null,pending=null,tableRows=[],tableEntry=null;
  const flushParagraph=()=>{
    if(!paragraph.length)return;
    const text=normalize(paragraph.join(' '));
    paragraph=[];
    if(!text)return;
    if(pending){pending.items.push(text);return}
    if(/^ATEN[ÇC][ÃA]O\b|^IMPORTANTE\b/iu.test(text))output.push(section('warning',{text},accessLevel,paragraphEntry,{source_scope:scope}));
    else if(/^[“"].+[”"]$/u.test(text))output.push(section('quote',{text},accessLevel,paragraphEntry,{source_scope:scope}));
    else output.push(section('paragraph',{text},accessLevel,paragraphEntry,{source_scope:scope}));
  };
  const flushBullets=()=>{
    if(!bullets.length)return;
    if(pending)pending.items.push(...bullets);
    else output.push(section('list',{items:bullets},accessLevel,bulletEntry,{source_scope:scope}));
    bullets=[];bulletEntry=null;
  };
  const flushTable=()=>{
    if(!tableRows.length)return;
    const width=Math.max(...tableRows.map(row=>row.length));
    if(width>1&&tableRows.length>1){
      const rows=tableRows.map(row=>Array.from({length:width},(_,index)=>normalize(row[index]||'')));
      output.push(section('table',{columns:Array.from({length:width},(_,index)=>`Coluna ${index+1}`),rows},accessLevel,tableEntry,{source_scope:scope,component_type:'source_table'}));
    }else{
      tableRows.flat().filter(Boolean).forEach(text=>output.push(section('paragraph',{text},accessLevel,tableEntry,{source_scope:scope})));
    }
    tableRows=[];tableEntry=null;
  };
  const flushPending=()=>{
    if(!pending)return;
    const items=pending.items.filter(Boolean).filter(item=>{
      const itemFold=fold(item),labelFold=fold(pending.label);
      return itemFold!==labelFold&&!(pending.type==='rule_black'&&itemFold==='REGRA BLACK');
    }),base={source_scope:scope,editorial_role:pending.role,label:pending.label};
    if(pending.type==='chapter_checklist'){
      output.push(section(pending.type,{items:items.length?items:[pending.label]},accessLevel,pending.entry,base));
    }else if(['exercise','exercise_black','example'].includes(pending.type)){
      output.push(section(pending.type,{prompt:items[0]||pending.label,...(items.length>1?{steps:items.slice(1)}:{})},accessLevel,pending.entry,base));
    }else{
      output.push(section(pending.type,{text:items.join(' ')||pending.label},accessLevel,pending.entry,base));
    }
    pending=null;
  };
  const flushAll=()=>{flushParagraph();flushBullets();flushTable();flushPending()};

  for(let index=0;index<entries.length;index+=1){
    const entry=entries[index];
    if(entry.blank){flushParagraph();flushBullets();flushTable();continue}
    if(marker(entry))continue;
    const descriptor=headingDescriptor(entry.text);
    if(descriptor){
      flushParagraph();flushBullets();flushTable();flushPending();
      if(descriptor.type==='subheading')output.push(section('subheading',{text:descriptor.label},accessLevel,entry,{source_scope:scope,editorial_role:descriptor.role}));
      else pending={...descriptor,entry,items:[]};
      continue;
    }
    if(isBullet(entry.text)){
      flushParagraph();flushTable();
      const item=bulletText(entry.text);
      if(item){if(!bulletEntry)bulletEntry=entry;bullets.push(item)}
      continue;
    }
    if(entry.text==='•'){
      flushParagraph();flushTable();
      const next=entries[index+1];
      if(next&&!next.blank&&!marker(next)){
        if(!bulletEntry)bulletEntry=entry;
        bullets.push(next.text);index+=1;
      }
      continue;
    }
    const trimmedRaw=entry.raw.trim();
    const columns=trimmedRaw.split(/\s{5,}/).map(normalize).filter(Boolean);
    if(columns.length>1){
      flushParagraph();flushBullets();
      if(!tableEntry)tableEntry=entry;
      tableRows.push(columns);
      continue;
    }
    flushBullets();flushTable();
    if(!paragraphEntry)paragraphEntry=entry;
    paragraph.push(entry.text);
  }
  flushAll();

  const merged=[];
  for(let index=0;index<output.length;index+=1){
    const current=output[index];
    const rows=[];
    let cursor=index;
    while(cursor<output.length&&output[cursor].section_type==='paragraph'){
      const text=output[cursor].content.text,match=text.match(/^([^:]{2,100}):\s*(.*)$/u);
      if(!match)break;
      rows.push([normalize(match[1]),normalize(match[2])]);cursor+=1;
    }
    if(rows.length>=2){
      merged.push(section('table',{columns:['Campo','Registro'],rows},accessLevel,{page:current.metadata.source_page},{source_scope:scope,component_type:'field_table'}));
      index=cursor-1;
    }else merged.push(current);
  }
  return merged.map((item,index)=>({...item,position:index+1}));
}

function buildDocument(raw,pdfBuffer,convertedAt){
  const entries=sourceEntries(raw),{parts,chapters,allParts}=selectedMarkers(entries);
  const sourceHash=hash(pdfBuffer),textHash=hash(raw);
  const documentParts=[];
  const chapterRanges=[],partRanges=[];

  EXPECTED_PARTS.forEach(expected=>{
    const partMarker=parts.get(expected.position),firstChapter=chapters.get(expected.chapters[0]);
    if(fold(partMarker.title)!==fold(expected.title))fail(`part ${expected.position} title differs from canonical contract`);
    const openingEntries=entries.slice(partMarker.index+1,firstChapter.index);
    const openingAccess=expected.position<=2?'sample':'knowledge';
    const openingSections=sectionize(openingEntries,openingAccess,'part_opening');
    const normalizedChapters=[];
    const followingPart=allParts.find(item=>item.number===expected.position+1&&item.index>partMarker.index);
    partRanges.push({part:expected.position,start:partMarker.index,end:followingPart?.index||entries.length});
    for(let number=expected.chapters[0];number<=expected.chapters[1];number+=1){
      const chapterMarker=chapters.get(number),nextChapter=chapters.get(number+1);
      const nextPart=allParts.find(item=>item.number===expected.position+1&&item.index>chapterMarker.index);
      const candidates=[entries.length,nextChapter?.index,nextPart?.index].filter(Number.isInteger);
      const end=Math.min(...candidates.filter(value=>value>chapterMarker.index));
      const titleResult=consumeTitle(entries,chapterMarker.index+1,chapterMarker.title,end);
      const chapterAccess=number===1?'sample':'knowledge';
      let sections=sectionize(entries.slice(titleResult.bodyStart,end),chapterAccess,'chapter_body');
      if(number===expected.chapters[0]&&openingSections.length){
        sections=[...openingSections,...sections].map((item,index)=>({...item,position:index+1}));
      }
      if(!sections.length)fail(`chapter ${number} has no sections`);
      const words=sections.reduce((total,item)=>total+JSON.stringify(item.content).split(/\s+/).length,0);
      const firstParagraph=sections.find(item=>item.section_type==='paragraph');
      normalizedChapters.push({
        chapter_number:number,
        slug:`capitulo-${number}-${slugify(titleResult.title)}`,
        position:number-expected.chapters[0]+1,
        title:titleResult.title,
        subtitle:null,
        excerpt:firstParagraph?firstParagraph.content.text.slice(0,240):null,
        access_level:chapterAccess,
        estimated_read_minutes:Math.max(1,Math.ceil(words/200)),
        active:true,
        sections
      });
      chapterRanges.push({number,part:expected.position,start:chapterMarker.index,end,page:chapterMarker.page});
    }
    documentParts.push({position:expected.position,title:expected.title,chapters:normalizedChapters});
  });

  const document={
    publication:{
      slug:'mentoria-black',title:'Mentoria Black',subtitle:'Conhecimento para transformar organização em direção.',
      description:'Publicação estruturada e protegida da Mentoria Black.',author:null,cover_path:null,
      publication_type:'book',version:'parts-1-4-v1',status:'published'
    },
    editorial_metadata:{
      publication_version:'1.0',content_version:'parts-1-4-v1',source_hash:sourceHash,
      converted_at:convertedAt,structure_version:'knowledge-structured-v1.1'
    },
    parts:documentParts
  };
  const validated=validateKnowledgeDocument(document);
  return {document:validated,entries,chapterRanges,partRanges,sourceHash,textHash};
}

function chapterForIndex(ranges,index){return ranges.find(item=>index>=item.start&&index<item.end)||null}
function editorialFindings(entries,ranges,partRanges){
  const findings=[];
  EDITORIAL_TERMS.forEach(term=>{
    entries.forEach((entry,index)=>{
      if(entry.blank)return;
      const matches=entry.text.match(new RegExp(term.pattern.source,term.pattern.flags))||[];
      const location=chapterForIndex(ranges,index),part=location?.part||partRanges.find(item=>index>=item.start&&index<item.end)?.part||null;
      matches.forEach(()=>findings.push({part,chapter:location?.number||null,page:entry.page,type:term.label,suggestion:term.suggestion}));
    });
  });
  return findings;
}
function metrics(document,sourceHash,textHash,findings){
  const chapters=document.parts.flatMap(part=>part.chapters),sections=chapters.flatMap(chapter=>chapter.sections);
  const typeCounts={},accessCounts={},componentCounts={};
  sections.forEach(item=>{
    typeCounts[item.section_type]=(typeCounts[item.section_type]||0)+1;
    accessCounts[item.access_level]=(accessCounts[item.access_level]||0)+1;
    if(item.metadata.component_type)componentCounts[item.metadata.component_type]=(componentCounts[item.metadata.component_type]||0)+1;
  });
  return {
    publication:'Mentoria Black',source_pdf_sha256:sourceHash,extracted_text_sha256:textHash,
    structured_sha256:hash(JSON.stringify(document)),publication_version:document.editorial_metadata.publication_version,
    content_version:document.editorial_metadata.content_version,structure_version:document.editorial_metadata.structure_version,
    converted_at:document.editorial_metadata.converted_at,
    totals:{parts:document.parts.length,chapters:chapters.length,sections:sections.length,
      rules_black:typeCounts.rule_black||0,exercises:(typeCounts.exercise||0)+(typeCounts.exercise_black||0),
      exercises_black:typeCounts.exercise_black||0,checklists:(typeCounts.checklist||0)+(typeCounts.chapter_checklist||0),
      impact_phrases:typeCounts.impact_phrase||0,tables:typeCounts.table||0,
      conclusions:sections.filter(item=>item.metadata.editorial_role==='conclusion').length,
      transitions:typeCounts.transition||0,editorial_findings:findings.length},
    section_types:typeCounts,access_levels:accessCounts,component_types:componentCounts,
    parts:document.parts.map(part=>({position:part.position,title:part.title,chapters:part.chapters.map(chapter=>({
      number:chapter.chapter_number,title:chapter.title,access_level:chapter.access_level,sections:chapter.sections.length,
      structured_sha256:hash(JSON.stringify(chapter))
    }))}))
  };
}
function editorialMarkdown(findings){
  const grouped=new Map();
  findings.forEach(item=>{
    const key=[item.part||'-',item.chapter||'-',item.type,item.suggestion].join('|');
    const current=grouped.get(key)||{...item,count:0,pages:new Set()};current.count+=1;current.pages.add(item.page);grouped.set(key,current);
  });
  const lines=['# Relatório editorial técnico — Partes 1–4','',
    'Este relatório registra somente nomenclaturas e localizações técnicas. O texto-fonte não foi alterado nem reproduzido.','',
    '| Parte | Capítulo | Inconsistência | Ocorrências | Páginas-fonte | Sugestão |','|---:|---:|---|---:|---|---|'];
  [...grouped.values()].sort((a,b)=>(a.part||99)-(b.part||99)||(a.chapter||99)-(b.chapter||99)||a.type.localeCompare(b.type)).forEach(item=>{
    lines.push(`| ${item.part||'—'} | ${item.chapter||(item.part?'Abertura':'—')} | ${item.type} | ${item.count} | ${[...item.pages].sort((a,b)=>a-b).join(', ')} | ${item.suggestion} |`);
  });
  if(!grouped.size)lines.push('| — | — | Nenhuma ocorrência-alvo | 0 | — | Revisão manual ainda recomendada. |');
  lines.push('','## Regra de revisão','','Nenhuma sugestão foi aplicada automaticamente. A decisão editorial deve anteceder qualquer importação remota.');
  return lines.join('\n');
}
function safeWrite(target,value){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,value,{encoding:'utf8',mode:0o600});
  fs.chmodSync(target,0o600);
}

function main(){
  const options=parseArgs(process.argv);
  if(!options.sourceText||!options.sourcePdf)fail('required: --source-text and --source-pdf');
  const sourceText=assertProtectedPath(options.sourceText,'source text');
  const sourcePdf=assertProtectedPath(options.sourcePdf,'source PDF');
  const raw=fs.readFileSync(sourceText,'utf8'),pdf=fs.readFileSync(sourcePdf);
  const convertedAt=options.convertedAt||new Date(fs.statSync(sourcePdf).mtimeMs).toISOString();
  const built=buildDocument(raw,pdf,convertedAt),findings=editorialFindings(built.entries,built.chapterRanges,built.partRanges);
  const summary=metrics(built.document,built.sourceHash,built.textHash,findings);
  if(summary.totals.parts!==4||summary.totals.chapters!==26)fail('canonical fidelity check failed: expected 4 parts and 26 chapters');
  if(options.mode==='validate-only'){
    console.log(`knowledge-book: valid (${summary.totals.parts} parts, ${summary.totals.chapters} chapters, ${summary.totals.sections} sections; no writes)`);
    return;
  }
  if(options.mode==='dry-run'){
    console.log(JSON.stringify({mode:'dry-run',parts:summary.totals.parts,chapters:summary.totals.chapters,sections:summary.totals.sections,
      access_levels:summary.access_levels,simulated:{publications:{insert:1,update:0},parts:{insert:4,update:0},chapters:{insert:26,update:0},sections:{insert:summary.totals.sections,update:0}},
      source_pdf_sha256:summary.source_pdf_sha256,structured_sha256:summary.structured_sha256},null,2));
    return;
  }
  if(!options.output)fail('--output is required in write mode');
  const output=assertProtectedPath(options.output,'structured output');
  safeWrite(output,`${JSON.stringify(built.document,null,2)}\n`);
  if(options.metricsOut)safeWrite(path.resolve(options.metricsOut),`${JSON.stringify(summary,null,2)}\n`);
  if(options.editorialOut)safeWrite(path.resolve(options.editorialOut),`${editorialMarkdown(findings)}\n`);
  console.log(`knowledge-book: structured (${summary.totals.parts} parts, ${summary.totals.chapters} chapters, ${summary.totals.sections} sections; protected output)`);
}

try{main()}catch(error){console.error(`knowledge-book: ${error.message}`);process.exitCode=1}
