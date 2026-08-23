'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const knowledge=require('../knowledge/knowledge-area'),imports=require('../knowledge/import-contract');
let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
async function test(name,fn){await fn();tests++}

(async()=>{
await test('structured import accepts only the synthetic publication contract',()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../knowledge/fixtures/mentoria-black.mock.json'),'utf8'));
 const value=imports.validateKnowledgeDocument(fixture);
 equal(value.parts.length,2);equal(value.parts.flatMap(part=>part.chapters).length,3);equal(value.parts.flatMap(part=>part.chapters.flatMap(chapter=>chapter.sections)).length,9);
 assert.throws(()=>imports.validateKnowledgeDocument({...fixture,parts:[{...fixture.parts[0],chapters:[{...fixture.parts[0].chapters[0],sections:[{position:1,section_type:'paragraph',access_level:'sample',content:{html:'<script>bad()</script>'}}]}]}]}),/arbitrary HTML/);assertions++;
 assert.throws(()=>imports.validateKnowledgeDocument({...fixture,publication:{...fixture.publication,slug:'Unsafe Slug'}}),/invalid slug/);assertions++;
 assert.throws(()=>imports.validateKnowledgeDocument({...fixture,editorial_metadata:{...fixture.editorial_metadata,source_hash:'invalid'}}),/expected SHA-256/);assertions++;
});

await test('section renderer escapes content and supports all approved types',()=>{
 const sections=[
  ['paragraph',{text:'<script>bad()</script>'}],['heading',{text:'Direção'}],['subheading',{text:'Subtítulo'}],['quote',{text:'Sabedoria'}],['highlight',{text:'Disciplina'}],
  ['list',{items:['A','B']}],['checklist',{items:['A']}],['chapter_checklist',{items:['A']}],['table',{columns:['A'],rows:[['B']]}],
  ['exercise',{prompt:'Faça',steps:['Passo']}],['exercise_black',{prompt:'Faça'}],['example',{prompt:'Exemplo'}],['rule_black',{text:'Regra'}],
  ['impact_phrase',{text:'Impacto'}],['transition',{text:'Transição'}],['callout',{text:'Nota'}],['warning',{text:'Atenção'}],
  ['image',{asset_path:'assets/mock.png',alt:'Mock'}],['separator',{}]
 ];
 sections.forEach(([section_type,content])=>ok(knowledge.renderSection({section_type,content}).length>0,section_type));
 const unsafe=knowledge.renderSection({section_type:'paragraph',content:{text:'<img src=x onerror=bad()>'}});
 ok(!unsafe.includes('<img'));ok(unsafe.includes('&lt;img'));
 equal(knowledge.safeAssetPath('../secret.png'),'');equal(knowledge.safeAssetPath('https://bad.invalid/x.png'),'');equal(knowledge.safeAssetPath('assets/mock.png'),'assets/mock.png');
 ok(knowledge.renderSection({section_type:'rule_black',content:{text:'Regra'}}).includes('knowledge-rule-black'));
 ok(knowledge.renderSection({section_type:'impact_phrase',content:{text:'Impacto'}}).includes('knowledge-impact-phrase'));
 ok(knowledge.renderSection({section_type:'chapter_checklist',content:{items:['Item']}}).includes('knowledge-list chapter_checklist'));
 ok(knowledge.renderSection({section_type:'table',content:{columns:['A'],rows:[['B']]}}).includes('knowledge-table-wrap'));
});

await test('library is publication-driven and supports an empty state',()=>{
 const state={publications:[{id:'p1',title:'Mentoria Black',description:'Mock',publication_type:'book'}],chapters:[{id:'c1',publication_id:'p1'}],progress:[{chapter_id:'c1',progress_percent:50}]};
 const html=knowledge.renderLibrary(state);ok(html.includes('Área de Conhecimento'));ok(html.includes('50% concluído'));ok(html.includes('Continuar leitura'));ok(html.includes('mentoria-black-icon-512.png'));ok(!html.includes('knowledge-cover-placeholder'));
 ok(knowledge.renderLibrary({publications:[],chapters:[],progress:[]}).includes('Nenhuma publicação'));
});

await test('official production cover is deterministic',()=>{
 const html=knowledge.renderLibrary({publications:[{id:'cover',title:'Mentoria Black'}],chapters:[],progress:[]});
 ok(html.includes('data-cover="premium"'));ok(html.includes('assets/branding/mentoria-black-icon-512.png'));
});

await test('local visual preview isolates its cover switch from the production runtime',()=>{
 const preview=fs.readFileSync(path.join(__dirname,'../knowledge/preview.local.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../knowledge/preview.local.js'),'utf8'),runtime=fs.readFileSync(path.join(__dirname,'../knowledge/knowledge-area.js'),'utf8');
 ok(preview.includes('?cover=minimal'));ok(preview.includes('?cover=premium'));ok(preview.includes('?cover=book'));
 ok(script.includes('new URLSearchParams(location.search).get(\'cover\')'));ok(!runtime.includes('MBKnowledgeCoverVariant'));
});

await test('table of contents exposes titles while locking protected bodies',()=>{
 const state={entitlements:{knowledge:{hasAccess:false}},publications:[{id:'p1',title:'Mentoria Black'}],parts:[{id:'part1',publication_id:'p1',position:1,title:'Parte'}],chapters:[{id:'sample',publication_id:'p1',part_id:'part1',position:1,title:'Amostra',access_level:'sample',estimated_read_minutes:2},{id:'locked',publication_id:'p1',part_id:'part1',position:2,title:'Protegido',access_level:'knowledge',estimated_read_minutes:3}],progress:[],bookmarks:[],sections:[]};
 const html=knowledge.renderToc(state,'p1');ok(html.includes('Amostra'));ok(html.includes('Protegido'));ok(html.includes('Conteúdo completo · bloqueado'));ok(html.includes('Conhecer acesso completo'));
 equal(knowledge.chapterAllowed(state.chapters[1],state.entitlements),false);
 state.entitlements.knowledge.hasAccess=true;equal(knowledge.chapterAllowed(state.chapters[1],state.entitlements),true);
});

await test('reader renders a server-authorized sample without exposing protected body',()=>{
 const state={entitlements:{knowledge:{hasAccess:false}},parts:[{id:'z-part',position:1},{id:'a-part',position:2}],chapters:[{id:'c1',publication_id:'p1',part_id:'z-part',position:1,title:'Protegido',excerpt:'Apenas trecho',access_level:'knowledge'},{id:'c2',publication_id:'p1',part_id:'a-part',position:1,title:'Seguinte',access_level:'knowledge'}],sections:[{chapter_id:'c1',section_type:'paragraph',access_level:'sample',content:{text:'SAMPLE_BODY'} }],progress:[],bookmarks:[]};
 const html=knowledge.renderReader(state,'c1');ok(html.includes('Continue sua leitura'));ok(html.includes('SAMPLE_BODY'));ok(!html.includes('Marcar como concluído'));
 state.sections.push({chapter_id:'c1',section_type:'paragraph',access_level:'knowledge',content:{text:'PROTECTED_BODY'}});
 state.entitlements.knowledge.hasAccess=true;const reader=knowledge.renderReader(state,'c1');ok(reader.includes('PROTECTED_BODY'));ok(reader.includes('Marcar como concluído'));ok(reader.includes('data-id="c2"'));
});

await test('repository uses protected section query and identity-free RPCs',async()=>{
 const calls=[];
 const query=(table)=>{const chain={select(value){calls.push([table,'select',value]);return chain},order(){return Promise.resolve({data:[],error:null})},eq(column,value){calls.push([table,'eq',column,value]);return chain},then(resolve){resolve({data:[],error:null})}};return chain};
 const client={from:table=>query(table),rpc:async(name,payload)=>(calls.push(['rpc',name,payload]),{data:[],error:null})};
 const repo=knowledge.createRepository(client);await repo.sections('chapter-a');await repo.search('direção');await repo.progress('p','c',10,null,false);await repo.bookmark('p','c',null,true);
 ok(calls.some(call=>call[0]==='knowledge_sections'&&call[2]==='chapter_id'&&call[3]==='chapter-a'));
 const payloads=calls.filter(call=>call[0]==='rpc').map(call=>call[2]);ok(payloads.every(payload=>!payload||!Object.prototype.hasOwnProperty.call(payload,'user_id')));
});

await test('frontend integrates Knowledge after commercial entitlement resolution',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 ok(html.includes('knowledge/knowledge-area.js'));ok(html.includes('knowledge/knowledge-area.css'));ok(html.includes('mountKnowledgeArea("knowledgeRoot")'));ok(html.includes('commercialKnowledgeRoot'));
 const gate=html.indexOf('const commercial=await resolveCommercialSession()'),finance=html.indexOf('await load()',gate);ok(gate>0&&finance>gate);
});

await test('commercial content is not embedded in public assets',()=>{
 const files=['index.html','knowledge/knowledge-area.js','knowledge/knowledge-area.css','knowledge/fixtures/mentoria-black.mock.json'];
 const source=files.map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8')).join('\n');
 ok(source.includes('MOCK'));ok(!/SUPABASE_SERVICE_ROLE_KEY|ASAAS_API_KEY|sb_secret_|access_token\s*[:=]\s*["'][^"']+/i.test(source));
 ok(!source.includes('SECRET_BODY_SHOULD_NOT_RENDER'));
});

console.log(`knowledge-area-v1: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
