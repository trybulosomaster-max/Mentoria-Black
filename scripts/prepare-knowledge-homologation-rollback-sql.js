#!/usr/bin/env node
'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');

const PRODUCTION_REF='mwjqfzbpjmwiscvtxvfc';
const HOMOLOGATION_REF='amzgqfvyjaiaoohnbcfl';
const CANONICAL_HASH='9c9d90e12ea90f36ea85da291091ab9bb49b76590d9638c856f936dd41a670ad';
function fail(message){throw new Error(message)}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex')}
function uuidFor(value){
  const bytes=Buffer.from(hash(value).slice(0,32),'hex');
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function parseArgs(argv){
  const result={};
  for(let index=2;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    if(!key?.startsWith('--')||!value)fail('usage: --input <protected.json> --output <protected.sql> --project-ref <ref>');
    result[key.slice(2)]=value;
  }
  return result;
}
function protectedOutput(target){
  const resolved=path.resolve(target),repo=path.resolve('.'),local=path.resolve('.local-content'),tmp=path.resolve(process.env.TMPDIR||'/tmp');
  if(resolved.startsWith(`${repo}${path.sep}`)&&!resolved.startsWith(`${local}${path.sep}`))fail('rollback output must not be written to a versioned repository path');
  if(!resolved.startsWith(`${local}${path.sep}`)&&!resolved.startsWith(`${tmp}${path.sep}`))fail('rollback output must be inside .local-content or the system temporary directory');
  return resolved;
}

try{
  const args=parseArgs(process.argv);
  if(!args.input||!args.output||!args['project-ref'])fail('usage: --input <protected.json> --output <protected.sql> --project-ref <ref>');
  if(args['project-ref']===PRODUCTION_REF)fail('production project ref is forbidden');
  if(args['project-ref']!==HOMOLOGATION_REF)fail('project ref differs from the approved homologation target');
  const document=validateKnowledgeDocument(JSON.parse(fs.readFileSync(path.resolve(args.input),'utf8')));
  if(document.editorial_metadata.canonical_hash!==CANONICAL_HASH||document.editorial_metadata.content_version!=='parts-1-4-v2')fail('rollback input is not the approved canonical V2 document');
  const publicationId=uuidFor(`publication:${document.publication.slug}`),output=protectedOutput(args.output);
  const sql=`-- target: remote-beta (${HOMOLOGATION_REF})
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('knowledge-import:${CANONICAL_HASH}',0));
do $preflight$
declare v_parts integer;v_chapters integer;v_sections integer;
begin
  if current_database()<>'postgres' and current_database() !~ '^mb_knowledge_remote_homologation_' then
    raise exception 'protected rollback is restricted to the approved homologation database' using errcode='42501';
  end if;
  if not exists(select 1 from public.knowledge_publications where id='${publicationId}'::uuid and slug='mentoria-black' and version='parts-1-4-v2') then
    raise exception 'approved homologation publication is absent or drifted' using errcode='P0001';
  end if;
  select count(*) into v_parts from public.knowledge_parts where publication_id='${publicationId}'::uuid;
  select count(*) into v_chapters from public.knowledge_chapters where publication_id='${publicationId}'::uuid;
  select count(*) into v_sections from public.knowledge_sections s join public.knowledge_chapters c on c.id=s.chapter_id where c.publication_id='${publicationId}'::uuid;
  if v_parts<>4 or v_chapters<>26 or v_sections<>1469 then
    raise exception 'homologation content count drift: parts %, chapters %, sections %',v_parts,v_chapters,v_sections using errcode='P0001';
  end if;
end
$preflight$;
delete from public.knowledge_publications where id='${publicationId}'::uuid and slug='mentoria-black' and version='parts-1-4-v2';
do $verify$
begin
  if exists(select 1 from public.knowledge_publications where id='${publicationId}'::uuid)
     or exists(select 1 from public.knowledge_parts where publication_id='${publicationId}'::uuid)
     or exists(select 1 from public.knowledge_chapters where publication_id='${publicationId}'::uuid)
     or exists(select 1 from public.knowledge_progress where publication_id='${publicationId}'::uuid)
     or exists(select 1 from public.knowledge_bookmarks where publication_id='${publicationId}'::uuid) then
    raise exception 'homologation rollback left target rows behind' using errcode='P0001';
  end if;
end
$verify$;
commit;
`;
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,sql,{encoding:'utf8',mode:0o600});fs.chmodSync(output,0o600);
  console.log('knowledge-homologation-rollback: prepared (exact publication identity; protected output)');
}catch(error){console.error(`knowledge-homologation-rollback: ${error.message}`);process.exitCode=1}
