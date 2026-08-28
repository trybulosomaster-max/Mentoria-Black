'use strict';

const assert=require('node:assert/strict');
const reader=require('../knowledge/reader-experience');
const knowledge=require('../knowledge/knowledge-area');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions+=1;assert.equal(actual,expected,message)};
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
const test=(name,fn)=>{fn();tests+=1};

function memoryStorage(){
  const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test('preferências de tema, fonte, entrelinha e largura persistem por escopo',()=>{
  const storage=memoryStorage(),store=reader.createReaderStore({storage,scope:'user-a'});
  equal(store.preferences().theme,'dark');
  store.preferences({theme:'sepia',fontSize:'large',lineHeight:'airy',width:'narrow'});
  const reopened=reader.createReaderStore({storage,scope:'user-a'});
  assert.deepEqual(reopened.preferences(),{theme:'sepia',fontSize:'large',lineHeight:'airy',width:'narrow'});assertions+=1;
  equal(reader.createReaderStore({storage,scope:'user-b'}).preferences().theme,'dark','outro usuário/dispositivo não herda preferências');
});

test('posição de retomada preserva seção e avanço sem virar fonte de negócio',()=>{
  const store=reader.createReaderStore({storage:memoryStorage(),scope:'reader'});
  store.position('chapter-1',{sectionId:'section-3',offsetRatio:.64});
  const saved=store.position('chapter-1');equal(saved.sectionId,'section-3');equal(saved.offsetRatio,.64);ok(saved.updatedAt);
  equal(store.position('chapter-2'),null);
});

test('grifo, sublinhado e nota têm ciclo local de criar, editar e excluir',()=>{
  let next=0;const store=reader.createReaderStore({storage:memoryStorage(),scope:'reader',now:()=>`t${next}`,idFactory:()=>`a${++next}`});
  const base={publicationId:'p',chapterId:'c',sectionId:'s',quote:'Trecho selecionado',start:4,end:22};
  const highlight=store.addAnnotation({...base,kind:'highlight'}),underline=store.addAnnotation({...base,start:24,end:42,kind:'underline'}),note=store.addAnnotation({...base,start:44,end:62,kind:'note',note:'Minha nota'});
  equal(store.annotations('c').length,3);equal(highlight.kind,'highlight');equal(underline.kind,'underline');equal(note.note,'Minha nota');
  equal(store.updateAnnotation(note.id,{note:'Nota revisada'}).note,'Nota revisada');ok(store.removeAnnotation(highlight.id));equal(store.annotations('c').length,2);
});

test('reader avançado preserva conteúdo, capítulo, progresso, favoritos e paywall',()=>{
  const state={
    entitlements:{knowledge:{hasAccess:true}},parts:[{id:'part',position:1}],chapters:[{id:'c',publication_id:'p',part_id:'part',position:1,title:'Capítulo',access_level:'knowledge'}],
    sections:[{id:'s',chapter_id:'c',position:1,section_type:'paragraph',content:{text:'Conteúdo editorial intacto'}}],progress:[{chapter_id:'c',progress_percent:40,last_section_id:'s'}],bookmarks:[{chapter_id:'c',section_id:'s'}],
    readerPreferences:{theme:'light',fontSize:'x-large',lineHeight:'compact',width:'wide'},readerAnnotations:[]
  };
  const html=knowledge.renderReader(state,'c');
  for(const value of ['Conteúdo editorial intacto','data-reader-theme="light"','data-reader-font-size="x-large"','Preferências de leitura','Salvar nota','★ Ponto salvo','40% concluído'])ok(html.includes(value),value);
  state.entitlements.knowledge.hasAccess=false;state.sections=[];ok(knowledge.renderReader(state,'c').includes('Conhecer acesso completo'));
});

test('lista de anotações mantém nota, navegação ao trecho e exclusão explícita',()=>{
  const state={chapters:[{id:'c',title:'Capítulo'}],readerAnnotations:[{id:'a',chapterId:'c',sectionId:'s',quote:'Trecho',kind:'note',note:'Comentário'}]};
  const html=knowledge.renderAnnotations(state,'c');
  for(const value of ['Anotações','Trecho','Comentário','data-section-id="s"','Editar','Excluir'])ok(html.includes(value),value);
});

console.log(`knowledge-reader-advanced: ${tests} tests, ${assertions} assertions passed`);
