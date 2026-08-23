'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');

const root=path.resolve(__dirname,'..');
const basePath=path.join(root,'.local-content/mentoria-black-partes-1-a-4.structured.json');
const canonicalPath=path.join(root,'.local-content/mentoria-black-partes-1-a-4.canonical-v2.json');
const metricsPath=path.join(root,'knowledge/reports/parts-1-4-canonical-metrics.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonicalHash=document=>sha(JSON.stringify({publication:document.publication,parts:document.parts}));
let assertions=0;
const same=(actual,expected,message)=>{assertions+=1;assert.deepStrictEqual(actual,expected,message)};
const check=(value,message)=>{assertions+=1;assert.ok(value,message)};
const count=(document,pattern)=>(JSON.stringify(document.parts).match(pattern)||[]).length;
const section=(document,part,chapter,position)=>document.parts.find(item=>item.position===part).chapters.find(item=>item.chapter_number===chapter).sections.find(item=>item.position===position);
const accessFingerprint=document=>document.parts.flatMap(part=>part.chapters.flatMap(chapter=>[
  `c:${part.position}:${chapter.chapter_number}:${chapter.access_level}`,
  ...chapter.sections.map(item=>`s:${part.position}:${chapter.chapter_number}:${item.position}:${item.access_level}`)
]));
const sourceFingerprint=document=>document.parts.flatMap(part=>part.chapters.flatMap(chapter=>chapter.sections.map(item=>
  `${part.position}:${chapter.chapter_number}:${item.position}:${item.metadata.source_hash}`
)));

for(const target of [basePath,canonicalPath]){
  check(fs.existsSync(target),`${path.basename(target)} exists`);
  check(target.startsWith(`${path.join(root,'.local-content')}${path.sep}`),'protected content stays under .local-content');
}
const base=validateKnowledgeDocument(JSON.parse(fs.readFileSync(basePath,'utf8')));
const canonical=validateKnowledgeDocument(JSON.parse(fs.readFileSync(canonicalPath,'utf8')));
const metrics=JSON.parse(fs.readFileSync(metricsPath,'utf8'));
const baseChapters=base.parts.flatMap(part=>part.chapters),canonicalChapters=canonical.parts.flatMap(part=>part.chapters);
const baseSections=baseChapters.flatMap(chapter=>chapter.sections),canonicalSections=canonicalChapters.flatMap(chapter=>chapter.sections);

same(base.editorial_metadata.content_version,'parts-1-4-v1','base version remains immutable');
same(canonical.editorial_metadata.content_version,'parts-1-4-v2','canonical version increments');
same(canonical.publication.version,'parts-1-4-v2','publication version increments');
same(canonical.editorial_metadata.source_hash,base.editorial_metadata.source_hash,'original PDF hash is preserved');
same(canonical.editorial_metadata.canonical_hash,canonicalHash(canonical),'canonical content hash is reproducible');
same(canonical.editorial_metadata.canonical_hash,metrics.canonical_hash,'metrics record the canonical hash');
same(canonical.editorial_metadata.editorial_revision.corrections_applied,27,'approved correction count');
same(canonical.editorial_metadata.editorial_revision.changed_fields,26,'changed field count');
same(canonical.editorial_metadata.editorial_revision.original_findings,40,'original editorial finding count');
same(canonical.editorial_metadata.editorial_revision.supplemental_findings,3,'supplemental finding count');
same(canonical.editorial_metadata.editorial_revision.preserved_after_semantic_review,16,'semantically valid findings preserved');

same(canonical.parts.map(part=>part.title),base.parts.map(part=>part.title),'four canonical part titles stay unchanged');
same(canonicalChapters.map(chapter=>chapter.chapter_number),baseChapters.map(chapter=>chapter.chapter_number),'all 26 chapters stay unchanged');
same(canonicalChapters.map(chapter=>chapter.title),baseChapters.map(chapter=>chapter.title),'chapter titles stay unchanged');
same(canonicalSections.map(item=>item.section_type),baseSections.map(item=>item.section_type),'semantic section types stay unchanged');
same(accessFingerprint(canonical),accessFingerprint(base),'sample/knowledge contract stays byte-for-byte equivalent');
same(sourceFingerprint(canonical),sourceFingerprint(base),'section source hashes retain PDF provenance');
same([canonical.parts.length,canonicalChapters.length,canonicalSections.length],[4,26,1469],'structural fidelity');
same([metrics.metrics.rules_black,metrics.metrics.checklists,metrics.metrics.impact_phrases],[26,26,26],'rules, checklists and impact phrases stay complete');
same([metrics.metrics.exercises,metrics.metrics.tables,metrics.metrics.conclusions,metrics.metrics.transitions],[28,8,3,6],'exercises, tables, conclusions and transitions stay complete');
same(metrics.metrics.access_levels,{sample:67,knowledge:1402},'access-level counts stay unchanged');

same(count(canonical,/\b(?:Sistema\s+)?Black\s*8\b/giu),0,'Black 8 removed');
same(count(canonical,/\bGrandes\s+Projetos\b/giu),0,'Grandes Projetos removed');
same(count(canonical,/\bLiberdade\s+Financeira\b/giu),8,'conceptual liberdade financeira occurrences preserved');
same(count(canonical,/\bM[ée]todo\s+Black\b/giu),3,'Método Black remains only in broad methodology contexts');
same(count(canonical,/\bduas\s+cartas\b/giu),0,'cart wording corrected');
same(count(canonical,/\bApós\s+de\s+8\s+anos\b/giu),0,'objective grammar corrected');
same(count(canonical,/\bPequenos?\s+Imprevistos?\b/giu),2,'only explanatory non-category mentions remain');
const smallUnexpected=canonicalSections.filter(item=>/\bPequenos?\s+Imprevistos?\b/iu.test(JSON.stringify(item.content)));
check(smallUnexpected.every(item=>{
  const value=JSON.stringify(item.content);
  return /margens/iu.test(value)&&/categorias/iu.test(value)&&/acumulad/iu.test(value);
}),'remaining small-unexpected references explicitly point to accumulated category margins');

const categoryExample=section(canonical,3,15,64).content.steps;
const marker=categoryExample.indexOf('Mas o orçamento já possui:');
same(categoryExample.slice(marker+1,marker+7),['Custos Fixos.','Investimentos.','Lazer.','Conforto.','Metas.','Conhecimento.'],'card example uses the six official categories');
check(!categoryExample.includes('Metas Recorrentes.')&&!categoryExample.includes('Pequenos Imprevistos.'),'card example has no seventh/eighth category');
check(section(canonical,3,19,72).content.text.includes('aportes mensais normais para Investimentos'),'category use of liberdade financeira reconciled');
check(section(canonical,4,26,62).content.text.includes('Metas de Longo Prazo'),'long projects nomenclature reconciled');
check(section(canonical,2,11,86).content.text.includes('O Sistema Black 6 não foi criado'),'category methodology uses Sistema Black 6');
check(section(canonical,3,15,14).content.text.includes('Método Black'),'broad credit methodology preserves Método Black');
check(section(canonical,4,26,77).content.text.includes('MÉTODO BLACK'),'broad security methodology preserves Método Black');

console.log(`knowledge-editorial-review: ${assertions} assertions passed`);
