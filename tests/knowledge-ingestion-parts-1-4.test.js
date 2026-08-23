'use strict';

const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');
const knowledgeArea=require('../knowledge/knowledge-area');

const root=path.resolve(__dirname,'..');
const protectedDocument=path.resolve(process.env.MB_KNOWLEDGE_PARTS_1_4||path.join(root,'.local-content/mentoria-black-partes-1-a-4.structured.json'));
const metricsPath=path.join(root,'knowledge/reports/parts-1-4-metrics.json');
let assertions=0;
const check=(value,message)=>{assertions+=1;assert.ok(value,message)};
const same=(actual,expected,message)=>{assertions+=1;assert.deepStrictEqual(actual,expected,message)};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

if(!protectedDocument.startsWith(`${path.join(root,'.local-content')}${path.sep}`))throw new Error('real content fixture must remain inside .local-content');
const document=validateKnowledgeDocument(JSON.parse(fs.readFileSync(protectedDocument,'utf8')));
const metrics=JSON.parse(fs.readFileSync(metricsPath,'utf8'));
const chapters=document.parts.flatMap(part=>part.chapters),sections=chapters.flatMap(chapter=>chapter.sections);

same(document.parts.map(part=>part.title),[
  'Mentalidade e Comportamento Financeiro','Organização Financeira','Cartão de Crédito','Reserva de Emergência e Segurança'
],'canonical parts');
same(document.parts.map(part=>part.chapters.map(chapter=>chapter.chapter_number)),[
  [1,2,3,4,5,6,7,8],[9,10,11,12,13,14],[15,16,17,18,19,20],[21,22,23,24,25,26]
],'canonical chapter ranges');
same([document.parts.length,chapters.length,sections.length],[4,26,metrics.totals.sections],'fidelity counts');
same(chapters.filter(chapter=>chapter.access_level==='sample').map(chapter=>chapter.chapter_number),[1],'only chapter one is a sample chapter');
check(chapters.filter(chapter=>chapter.chapter_number===9)[0].sections.some(section=>section.access_level==='sample'&&section.metadata.source_scope==='part_opening'),'part two opening is sample within a protected chapter');
check(chapters.filter(chapter=>chapter.chapter_number===9)[0].sections.some(section=>section.access_level==='knowledge'),'part two body remains protected');
check(chapters.filter(chapter=>chapter.chapter_number===15)[0].sections.every(section=>section.access_level==='knowledge'),'part three body is protected');
check(chapters.filter(chapter=>chapter.chapter_number===21)[0].sections.every(section=>section.access_level==='knowledge'),'part four body is protected');
['rule_black','exercise_black','chapter_checklist','impact_phrase','table','example'].forEach(type=>check(sections.some(section=>section.section_type===type),`missing ${type}`));
check(sections.every(section=>/^[0-9a-f]{64}$/.test(section.metadata.source_hash)),'every section has a source hash');
same(document.editorial_metadata.source_hash,metrics.source_pdf_sha256,'canonical PDF hash');
same(sha(JSON.stringify(document)),metrics.structured_sha256,'structured hash');
same(metrics.totals.parts,4);same(metrics.totals.chapters,26);
same(metrics.totals.checklists,26);same(metrics.totals.impact_phrases,26);
check(metrics.totals.rules_black>=26,'rules preserved');check(metrics.totals.exercises>=26,'exercises preserved');
check(metrics.totals.tables>0,'tables preserved');check(metrics.totals.editorial_findings>0,'editorial findings recorded');

const sourceChapterNine=chapters.find(chapter=>chapter.chapter_number===9);
const readerChapter={...sourceChapterNine,id:'chapter-9',publication_id:'publication',part_id:'part-2'};
const sampleSections=sourceChapterNine.sections.filter(section=>section.access_level==='sample').map(section=>({...section,chapter_id:'chapter-9'}));
const protectedParagraph=sourceChapterNine.sections.find(section=>section.access_level==='knowledge'&&section.section_type==='paragraph');
const sampleParagraph=sampleSections.find(section=>section.section_type==='paragraph');
const readerState={entitlements:{knowledge:{hasAccess:false}},parts:[{id:'part-2',position:2}],chapters:[readerChapter],sections:sampleSections,progress:[],bookmarks:[]};
const sampleHtml=knowledgeArea.renderReader(readerState,'chapter-9');
check(sampleHtml.includes('Continue sua leitura')&&sampleHtml.includes('data-offer="knowledge"'),'mixed chapter ends in the KNOWLEDGE paywall');
check(sampleParagraph&&sampleHtml.includes(knowledgeArea.safe(sampleParagraph.content.text)),'mixed chapter renders its authorized opening');
check(protectedParagraph&&!sampleHtml.includes(knowledgeArea.safe(protectedParagraph.content.text)),'mixed chapter does not render protected body');
readerState.entitlements.knowledge.hasAccess=true;readerState.sections=sourceChapterNine.sections.map(section=>({...section,chapter_id:'chapter-9'}));
check(knowledgeArea.renderReader(readerState,'chapter-9').includes(knowledgeArea.safe(protectedParagraph.content.text)),'KNOWLEDGE reader renders the protected body');

console.log(`knowledge-ingestion-parts-1-4: ${assertions} assertions passed`);
