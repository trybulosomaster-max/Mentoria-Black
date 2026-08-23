#!/usr/bin/env node
'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');

const BASE_STRUCTURED_SHA256='3b000845e0a1d7dd77f50925bebe0b340238142b834b4eb476896137dffb9900';
const SOURCE_PDF_SHA256='92e9b55f22dc6ae132ade8965242dc2d34e69a0b956339b22e1b4d5e2dc9f069';
const BASE_CONTENT_VERSION='parts-1-4-v1';
const CONTENT_VERSION='parts-1-4-v2';
const RULESET_VERSION='mentoria-black-editorial-v1';
const OFFICIAL_CATEGORIES=Object.freeze(['Custos Fixos.','Investimentos.','Lazer.','Conforto.','Metas.','Conhecimento.']);
const LEGACY_CATEGORY_BLOCK_SHA256='8c8a59cb086c57f50dc4381ebae704706e3c00d8550ff8143bfcf24a6ce5bfb9';

function fail(message){throw new Error(message)}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex')}
function parseArgs(argv){
  const options={mode:'write'};
  for(let index=2;index<argv.length;index+=1){
    const argument=argv[index];
    if(argument==='--validate-only')options.mode='validate-only';
    else if(argument==='--dry-run')options.mode='dry-run';
    else if(argument.startsWith('--')){
      const key=argument.slice(2).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
      const value=argv[++index];
      if(!value||value.startsWith('--'))fail(`${argument} requires a value`);
      options[key]=value;
    }else fail(`unexpected argument: ${argument}`);
  }
  return options;
}
function protectedPath(target,label){
  const resolved=path.resolve(target),root=path.resolve('.local-content');
  if(resolved!==root&&!resolved.startsWith(`${root}${path.sep}`))fail(`${label} must be inside .local-content`);
  return resolved;
}
function safeWrite(target,value,{protectedOutput=false}={}){
  const resolved=protectedOutput?protectedPath(target,'canonical output'):path.resolve(target);
  fs.mkdirSync(path.dirname(resolved),{recursive:true});
  fs.writeFileSync(resolved,value,{encoding:'utf8',mode:protectedOutput?0o600:0o644});
  fs.chmodSync(resolved,protectedOutput?0o600:0o644);
}
function clone(value){return JSON.parse(JSON.stringify(value))}
function section(document,partPosition,chapterNumber,sectionPosition){
  const part=document.parts.find(item=>item.position===partPosition);
  const chapter=part?.chapters.find(item=>item.chapter_number===chapterNumber);
  const target=chapter?.sections.find(item=>item.position===sectionPosition);
  if(!target)fail(`missing section P${partPosition} C${chapterNumber} S${sectionPosition}`);
  return target;
}
function replaceOnce(value,before,after,label){
  const first=value.indexOf(before);
  if(first<0||value.indexOf(before,first+before.length)>=0)fail(`${label}: expected exactly one canonical source fragment`);
  return value.slice(0,first)+after+value.slice(first+before.length);
}
function termCounts(document){
  const content=JSON.stringify(document.parts),count=pattern=>(content.match(pattern)||[]).length;
  return {
    black_8:count(/\b(?:Sistema\s+)?Black\s*8\b/giu),
    grandes_projetos:count(/\bGrandes\s+Projetos\b/giu),
    liberdade_financeira:count(/\bLiberdade\s+Financeira\b/giu),
    pequenos_imprevistos:count(/\bPequenos?\s+Imprevistos?\b/giu),
    metodo_black:count(/\bM[ée]todo\s+Black\b/giu),
    sistema_black_6:count(/\bSistema\s+Black\s*6\b/giu),
    duas_cartas:count(/\bduas\s+cartas\b/giu),
    apos_de_oito_anos:count(/\bApós\s+de\s+8\s+anos\b/giu)
  };
}
function canonicalHash(document){return hash(JSON.stringify({publication:document.publication,parts:document.parts}))}
function assertAccessInvariant(before,after){
  const fingerprint=document=>document.parts.flatMap(part=>part.chapters.flatMap(chapter=>[
    `c:${part.position}:${chapter.chapter_number}:${chapter.access_level}`,
    ...chapter.sections.map(item=>`s:${part.position}:${chapter.chapter_number}:${item.position}:${item.access_level}`)
  ]));
  if(JSON.stringify(fingerprint(before))!==JSON.stringify(fingerprint(after)))fail('access-level contract changed during editorial revision');
}
function structuralMetrics(document){
  const chapters=document.parts.flatMap(part=>part.chapters),sections=chapters.flatMap(chapter=>chapter.sections),types={},access={};
  sections.forEach(item=>{types[item.section_type]=(types[item.section_type]||0)+1;access[item.access_level]=(access[item.access_level]||0)+1});
  return {
    parts:document.parts.length,chapters:chapters.length,sections:sections.length,
    rules_black:types.rule_black||0,
    exercises:(types.exercise||0)+(types.exercise_black||0),
    exercises_black:types.exercise_black||0,
    checklists:(types.checklist||0)+(types.chapter_checklist||0),
    impact_phrases:types.impact_phrase||0,
    tables:types.table||0,
    conclusions:sections.filter(item=>item.metadata.editorial_role==='conclusion').length,
    transitions:types.transition||0,
    access_levels:access,
    section_types:types
  };
}
function short(value){
  const words=String(value).replace(/\s+/g,' ').trim().split(' ');
  return words.length>8?`${words.slice(0,8).join(' ')}…`:words.join(' ');
}

function applyRevision(base,revisedAt){
  const document=clone(base),changes=[];
  const record=(part,chapter,type,before,after,justification)=>changes.push({part,chapter,type,before:short(before),after:short(after),justification});
  const setText=(part,chapter,position,before,after,type,justification)=>{
    const target=section(document,part,chapter,position);
    if(target.content.text!==before)fail(`P${part} C${chapter} S${position}: source text drift`);
    target.content.text=after;record(part,chapter,type,before,after,justification);
  };
  const replaceText=(part,chapter,position,before,after,type,justification)=>{
    const target=section(document,part,chapter,position),original=target.content.text;
    if(typeof original!=='string')fail(`P${part} C${chapter} S${position}: expected text content`);
    target.content.text=replaceOnce(original,before,after,`P${part} C${chapter} S${position}`);
    record(part,chapter,type,before,after,justification);
  };
  const replaceArrayItem=(part,chapter,position,key,before,after,type,justification)=>{
    const target=section(document,part,chapter,position),items=target.content[key];
    if(!Array.isArray(items))fail(`P${part} C${chapter} S${position}: expected ${key} array`);
    const indexes=items.map((item,index)=>typeof item==='string'&&item.includes(before)?index:-1).filter(index=>index>=0);
    if(indexes.length!==1)fail(`P${part} C${chapter} S${position}: expected one ${key} item containing canonical fragment`);
    items[indexes[0]]=replaceOnce(items[indexes[0]],before,after,`P${part} C${chapter} S${position} ${key}`);
    record(part,chapter,type,before,after,justification);
  };

  {
    const target=section(document,1,1,48);
    if(hash(target.content.text)!=='bdbadf1460fa2ea1f1348e1a8aa27da789bbfe971acc25cea78f5722ce157d4f')fail('P1 C1 S48: source text drift');
    const opening='Após 8 anos no Exército,';
    const transition='No começo dessa transição, passei um período sem receber.';
    const role='onde atuei na área de Economia e Finanças.';
    target.content.text=[opening,role,transition].join(' ');
    record(1,1,'gramática e fidelidade','Após de 8 anos no Exército','Após 8 anos no Exército','Corrige a regência e restaura uma frase curta preservada na fonte.');
  }
  setText(2,11,64,'E QUANTO AOS PEQUENOS IMPREVISTOS?','E QUANTO ÀS MARGENS PARA PEQUENAS VARIAÇÕES?',
    'nomenclatura','Evita apresentar pequenos imprevistos como categoria autônoma.');
  replaceText(2,11,71,
    'Pequenos imprevistos fazem parte da rotina.',
    'Pequenos imprevistos são absorvidos pelas margens acumuladas dentro das próprias categorias.',
    'metodologia','Explicita a regra canônica sem criar uma sétima categoria.');
  replaceText(2,11,86,'O Método Black não foi criado','O Sistema Black 6 não foi criado',
    'marca e metodologia','O contexto é a distribuição específica das seis categorias.');

  {
    const target=section(document,3,15,64),steps=target.content.steps;
    const marker=steps.indexOf('Mas o orçamento já possui:');
    if(marker<0||hash(JSON.stringify(steps.slice(marker+1,marker+9)))!==LEGACY_CATEGORY_BLOCK_SHA256)fail('P3 C15 S64: legacy category block drift');
    steps.splice(marker+1,8,...OFFICIAL_CATEGORIES);
    record(3,15,'Black 6','oito rótulos mistos','seis categorias oficiais','O exemplo do cartão passa a usar somente o Sistema Black 6.');
  }
  replaceText(3,16,77,'duas cartas','dois cartões','gramática','Corrige a palavra trocada no contexto de cartão de crédito.');
  setText(3,18,41,'O limite financeiro precisa conversar com o Black 8.','O limite financeiro precisa conversar com o Sistema Black 6.',
    'nomenclatura','Remove a nomenclatura antiga das categorias.');
  setText(3,19,33,'PEQUENOS IMPREVISTOS','MARGENS DAS CATEGORIAS','metodologia','Nomeia a fonte dos recursos, sem criar categoria adicional.');
  replaceText(3,19,72,'aportes mensais normais para Liberdade Financeira','aportes mensais normais para Investimentos',
    'categoria','A ocorrência representa a categoria de aportes, não o conceito de liberdade.');
  replaceArrayItem(3,19,75,'steps','Black 8','Sistema Black 6','nomenclatura','Remove a nomenclatura antiga das categorias.');

  setText(4,24,42,'É justamente para isso que existem as categorias do Black 8.','É justamente para isso que existem as categorias do Sistema Black 6.',
    'nomenclatura','Remove a nomenclatura antiga das categorias.');
  setText(4,24,43,'PEQUENO IMPREVISTO NÃO PRECISA VIRAR EMERGÊNCIA','PEQUENA VARIAÇÃO NÃO PRECISA VIRAR EMERGÊNCIA',
    'metodologia','Distingue uma variação absorvível de uma categoria financeira.');
  setText(4,24,44,'No Sistema Black 8 criamos uma estrutura para Pequenos Imprevistos.',
    'No Sistema Black 6, os saldos acumulados dentro das próprias categorias criam margens para pequenos imprevistos.',
    'metodologia','Aplica a regra canônica de margens e saldos acumulados.');
  replaceText(4,24,46,'absorvido ali','absorvido pela margem da categoria correspondente',
    'clareza','Elimina uma referência ambígua à antiga categoria.');
  replaceText(4,24,63,'metas, despesas previsíveis, Pequenos Imprevistos e reserva','metas, despesas previsíveis, margens das categorias e reserva',
    'metodologia','Separa planejamento, margem e Reserva de Emergência.');
  {
    const target=section(document,4,24,66),index=target.content.steps.indexOf('Pequeno Imprevisto');
    if(index<0)fail('P4 C24 S66: classification label drift');
    target.content.steps[index]='Pequena variação absorvível pela categoria';
    record(4,24,'exercício','Pequeno Imprevisto','Pequena variação absorvível pela categoria','A classificação deixa de sugerir uma sétima categoria.');
  }
  {
    const target=section(document,4,24,67),index=target.content.items.indexOf('Utilizo Pequenos Imprevistos para pequenas variações');
    if(index<0)fail('P4 C24 S67: checklist label drift');
    target.content.items[index]='Utilizo as margens das categorias para pequenas variações';
    record(4,24,'checklist','Utilizo Pequenos Imprevistos','Utilizo margens das categorias','O checklist passa a refletir a fonte canônica dos recursos.');
  }

  setText(4,26,53,'Existe algum gasto recorrente que deveria entrar no Black 8?','Existe algum gasto recorrente que deveria entrar no Sistema Black 6?',
    'nomenclatura','Remove a nomenclatura antiga das categorias.');
  setText(4,26,54,'Minha estrutura de Pequenos Imprevistos precisa mudar?','As margens acumuladas nas minhas categorias precisam mudar?',
    'metodologia','Substitui a antiga categoria pelas margens internas.');
  setText(4,26,60,'Pequenos Imprevistos absorvem pequenas variações da vida.','As margens acumuladas nas categorias absorvem pequenas variações da vida.',
    'metodologia','Mantém a função financeira no local correto.');
  setText(4,26,62,'Grandes Projetos constroem objetivos maiores.','Metas de Longo Prazo constroem objetivos maiores.',
    'nomenclatura','Adota o nome oficial para objetivos maiores planejados.');
  {
    const target=section(document,4,26,76),index=target.content.items.indexOf('Diferencio reserva, metas, Pequenos Imprevistos e colchão do cartão');
    if(index<0)fail('P4 C26 S76: checklist label drift');
    target.content.items[index]='Diferencio reserva, metas, margens das categorias e colchão do cartão';
    record(4,26,'checklist','reserva, metas, Pequenos Imprevistos','reserva, metas, margens das categorias','O checklist diferencia as camadas sem categoria adicional.');
  }
  setText(4,26,80,'PEQUENOS IMPREVISTOS','MARGENS DAS CATEGORIAS','metodologia','A camada passa a ser identificada pela fonte dos recursos.');
  setText(4,26,104,'MEUS PEQUENOS IMPREVISTOS','MINHAS MARGENS POR CATEGORIA','exercício','O exercício registra margens nas seis categorias.');
  setText(4,26,105,'Valor disponível:','Saldo disponível:','clareza','O campo passa a representar saldo acumulado da categoria.');
  replaceText(4,26,118,'Pequenos Imprevistos e Reserva de Emergência possuem funções diferentes.',
    'Margens acumuladas nas categorias e Reserva de Emergência possuem funções diferentes.',
    'metodologia','A conclusão mantém separadas margem operacional e proteção emergencial.');

  document.publication.version=CONTENT_VERSION;
  document.editorial_metadata.content_version=CONTENT_VERSION;
  document.editorial_metadata.editorial_revision={
    revision:'canonical-1',base_content_version:BASE_CONTENT_VERSION,ruleset_version:RULESET_VERSION,revised_at:revisedAt,
    original_findings:40,supplemental_findings:3,reviewed_occurrences:43,
    corrections_applied:27,changed_fields:changes.length,preserved_after_semantic_review:16
  };
  document.editorial_metadata.canonical_hash=canonicalHash(document);
  const validated=validateKnowledgeDocument(document);
  assertAccessInvariant(base,validated);
  return {document:validated,changes};
}

function changelogMarkdown(result,beforeTerms,afterTerms,metrics){
  const lines=['# Changelog editorial canônico — Partes 1–4','',
    'Revisão objetiva sobre a versão estruturada protegida. Este arquivo contém apenas excertos curtos e metadados; o livro integral permanece fora do Git.','',
    `- Versão-base: \`${BASE_CONTENT_VERSION}\``,
    `- Versão canônica: \`${CONTENT_VERSION}\``,
    `- Achados técnicos originais: ${result.document.editorial_metadata.editorial_revision.original_findings}`,
    `- Achados complementares: ${result.document.editorial_metadata.editorial_revision.supplemental_findings}`,
    `- Ocorrências revisadas: ${result.document.editorial_metadata.editorial_revision.reviewed_occurrences}`,
    `- Correções editoriais aplicadas: ${result.document.editorial_metadata.editorial_revision.corrections_applied}`,
    `- Campos estruturados alterados: ${result.changes.length}`,
    `- Hash canônico: \`${result.document.editorial_metadata.canonical_hash}\``,'',
    '| Parte | Capítulo | Tipo | Antes (curto) | Depois (curto) | Justificativa |','|---:|---:|---|---|---|---|'];
  result.changes.forEach(item=>lines.push(`| ${item.part} | ${item.chapter} | ${item.type} | ${item.before.replace(/\|/g,'/')} | ${item.after.replace(/\|/g,'/')} | ${item.justification} |`));
  lines.push('','## Decisões sem substituição','',
    '- 8 usos de “liberdade financeira” foram preservados como conceito, objetivo ou estado financeiro.',
    '- 3 usos de “Método Black” foram preservados por se referirem à metodologia ampla.',
    '- 6 usos já corretos de “Sistema Black 6” foram mantidos.','',
    '## Verificações','',
    `- Black 8: ${beforeTerms.black_8} → ${afterTerms.black_8}`,
    `- Grandes Projetos: ${beforeTerms.grandes_projetos} → ${afterTerms.grandes_projetos}`,
    `- Liberdade Financeira (total, incluindo conceito): ${beforeTerms.liberdade_financeira} → ${afterTerms.liberdade_financeira}`,
    `- Método Black (metodologia ampla): ${beforeTerms.metodo_black} → ${afterTerms.metodo_black}`,
    `- “duas cartas”: ${beforeTerms.duas_cartas} → ${afterTerms.duas_cartas}`,
    `- Estrutura preservada: ${metrics.parts} partes, ${metrics.chapters} capítulos, ${metrics.sections} seções.`,'',
    'Nenhuma correção foi aplicada ao PDF original, à versão estruturada V1 ou a qualquer ambiente remoto.');
  return `${lines.join('\n')}\n`;
}

function main(){
  const options=parseArgs(process.argv);
  if(!options.input)fail('--input is required');
  const input=protectedPath(options.input,'base input'),raw=fs.readFileSync(input,'utf8');
  const base=validateKnowledgeDocument(JSON.parse(raw));
  if(hash(JSON.stringify(base))!==BASE_STRUCTURED_SHA256)fail('base structured document checksum differs from the approved V1');
  if(base.editorial_metadata.source_hash!==SOURCE_PDF_SHA256||base.editorial_metadata.content_version!==BASE_CONTENT_VERSION)fail('base document identity differs from the approved source');
  const revisedAt=options.revisedAt||new Date().toISOString(),beforeTerms=termCounts(base),result=applyRevision(base,revisedAt),afterTerms=termCounts(result.document),metrics=structuralMetrics(result.document);
  if(metrics.parts!==4||metrics.chapters!==26||metrics.rules_black!==26||metrics.checklists!==26||metrics.impact_phrases!==26)fail('canonical structural fidelity check failed');
  if(metrics.sections!==1469||metrics.tables!==8||metrics.conclusions!==3||metrics.transitions!==6)fail('canonical metric drift');
  if(afterTerms.black_8||afterTerms.grandes_projetos||afterTerms.duas_cartas||afterTerms.apos_de_oito_anos)fail('legacy editorial term remains after revision');
  if(afterTerms.liberdade_financeira!==8||afterTerms.metodo_black!==3||afterTerms.pequenos_imprevistos!==2)fail('semantic preservation counts differ from the approved editorial decisions');
  const summary={mode:options.mode,source_hash:result.document.editorial_metadata.source_hash,canonical_hash:result.document.editorial_metadata.canonical_hash,
    content_version:result.document.editorial_metadata.content_version,corrections_applied:27,changed_fields:result.changes.length,
    preserved_after_semantic_review:16,metrics,terms_before:beforeTerms,terms_after:afterTerms};
  if(options.mode==='validate-only'){
    console.log(`knowledge-editorial: valid (${metrics.parts} parts, ${metrics.chapters} chapters, ${metrics.sections} sections, ${summary.corrections_applied} corrections; no writes)`);
    return;
  }
  if(options.mode==='dry-run'){
    console.log(JSON.stringify({...summary,simulated:{canonical_documents:{insert:1,update:0},remote_writes:0}},null,2));
    return;
  }
  if(!options.output||!options.metricsOut||!options.changelogOut)fail('write mode requires --output, --metrics-out and --changelog-out');
  safeWrite(options.output,`${JSON.stringify(result.document,null,2)}\n`,{protectedOutput:true});
  safeWrite(options.metricsOut,`${JSON.stringify({...summary,mode:'generated'},null,2)}\n`);
  safeWrite(options.changelogOut,changelogMarkdown(result,beforeTerms,afterTerms,metrics));
  console.log(`knowledge-editorial: canonical V2 generated (${result.changes.length} fields; protected output)`);
}

try{main()}catch(error){console.error(`knowledge-editorial: ${error.message}`);process.exitCode=1}
