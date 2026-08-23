#!/usr/bin/env node
'use strict';

const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {validateKnowledgeDocument}=require('../knowledge/import-contract');

function fail(message){throw new Error(message)}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex')}
function uuidFor(value){
  const bytes=Buffer.from(hash(value).slice(0,32),'hex');
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function sql(value){
  if(value===null||value===undefined)return 'null';
  return `'${String(value).replace(/'/g,"''")}'`;
}
function json(value){return `${sql(JSON.stringify(value))}::jsonb`}
function parseArgs(argv){
  const result={};
  for(let index=2;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    if(!key?.startsWith('--')||!value)fail('usage: --input <protected.json> --output <protected.sql>');
    result[key.slice(2)]=value;
  }
  return result;
}
function protectedOutput(target){
  const resolved=path.resolve(target),repo=path.resolve('.'),local=path.resolve('.local-content'),tmp=path.resolve(process.env.TMPDIR||'/tmp');
  if(resolved.startsWith(`${repo}${path.sep}`)&&!resolved.startsWith(`${local}${path.sep}`))fail('SQL output must not be written to a versioned repository path');
  if(!resolved.startsWith(`${local}${path.sep}`)&&!resolved.startsWith(`${tmp}${path.sep}`))fail('SQL output must be inside .local-content or the system temporary directory');
  return resolved;
}

function build(document){
  const publication=document.publication,publicationId=uuidFor(`publication:${publication.slug}`),lines=[];
  const parts=document.parts,chapters=parts.flatMap(part=>part.chapters),sections=chapters.flatMap(chapter=>chapter.sections);
  lines.push('begin;',"set local lock_timeout='5s';","set local statement_timeout='120s';",`select pg_advisory_xact_lock(hashtextextended(${sql(`knowledge-import:${document.editorial_metadata.source_hash}`)},0));`);
  lines.push("do $local_only$ begin if current_database() !~ '^mb_knowledge_parts_1_4_' then raise exception 'protected book import is restricted to the disposable local clone' using errcode='42501'; end if; end $local_only$;");
  lines.push(`do $preflight$ begin
    if to_regclass('public.knowledge_sections') is null or to_regprocedure('public.has_active_access(text)') is null then
      raise exception 'Knowledge Area V1 and Commercial Access V2 are required' using errcode='P0001';
    end if;
    if exists(select 1 from public.knowledge_publications where slug=${sql(publication.slug)} and id<>${sql(publicationId)}::uuid) then
      raise exception 'publication slug belongs to an incompatible identity' using errcode='P0001';
    end if;
  end $preflight$;`);
  lines.push(`insert into public.knowledge_publications(id,slug,title,subtitle,description,author,cover_path,publication_type,status,version,required_product_code,published_at)
    values(${sql(publicationId)}::uuid,${sql(publication.slug)},${sql(publication.title)},${sql(publication.subtitle)},${sql(publication.description)},${sql(publication.author)},${sql(publication.cover_path)},${sql(publication.publication_type)},${sql(publication.status)},${sql(publication.version)},'KNOWLEDGE',clock_timestamp())
    on conflict(slug) do nothing;`);
  lines.push(`do $publication_contract$ begin if not exists(
    select 1 from public.knowledge_publications where id=${sql(publicationId)}::uuid and slug=${sql(publication.slug)}
      and title=${sql(publication.title)} and subtitle is not distinct from ${sql(publication.subtitle)}
      and description is not distinct from ${sql(publication.description)} and author is not distinct from ${sql(publication.author)}
      and cover_path is not distinct from ${sql(publication.cover_path)} and publication_type=${sql(publication.publication_type)}
      and status=${sql(publication.status)} and version=${sql(publication.version)} and required_product_code='KNOWLEDGE'
  ) then raise exception 'publication contract drift' using errcode='P0001'; end if; end $publication_contract$;`);

  parts.forEach(part=>{
    const partId=uuidFor(`part:${publication.slug}:${part.position}`);
    lines.push(`insert into public.knowledge_parts(id,publication_id,position,title) values(${sql(partId)}::uuid,${sql(publicationId)}::uuid,${part.position},${sql(part.title)}) on conflict(publication_id,position) do nothing;`);
    lines.push(`do $part_contract$ begin if not exists(select 1 from public.knowledge_parts where id=${sql(partId)}::uuid and publication_id=${sql(publicationId)}::uuid and position=${part.position} and title=${sql(part.title)}) then raise exception 'part ${part.position} contract drift' using errcode='P0001'; end if; end $part_contract$;`);
    part.chapters.forEach(chapter=>{
      const chapterId=uuidFor(`chapter:${publication.slug}:${chapter.slug}`);
      lines.push(`insert into public.knowledge_chapters(id,publication_id,part_id,slug,position,title,subtitle,excerpt,access_level,estimated_read_minutes,active)
        values(${sql(chapterId)}::uuid,${sql(publicationId)}::uuid,${sql(partId)}::uuid,${sql(chapter.slug)},${chapter.position},${sql(chapter.title)},${sql(chapter.subtitle)},${sql(chapter.excerpt)},${sql(chapter.access_level)},${chapter.estimated_read_minutes},${chapter.active?'true':'false'})
        on conflict(publication_id,slug) do nothing;`);
      lines.push(`do $chapter_contract$ begin if not exists(
        select 1 from public.knowledge_chapters where id=${sql(chapterId)}::uuid and publication_id=${sql(publicationId)}::uuid and part_id=${sql(partId)}::uuid
          and slug=${sql(chapter.slug)} and position=${chapter.position} and title=${sql(chapter.title)}
          and subtitle is not distinct from ${sql(chapter.subtitle)} and excerpt is not distinct from ${sql(chapter.excerpt)}
          and access_level=${sql(chapter.access_level)} and estimated_read_minutes=${chapter.estimated_read_minutes} and active=${chapter.active?'true':'false'}
      ) then raise exception 'chapter ${chapter.chapter_number||chapter.position} contract drift' using errcode='P0001'; end if; end $chapter_contract$;`);
      const expected=[];
      chapter.sections.forEach(item=>{
        const sectionId=uuidFor(`section:${publication.slug}:${chapter.slug}:${item.position}`);
        expected.push(`(${sql(sectionId)}::uuid,${item.position},${sql(item.section_type)},${json(item.content)},${json(item.metadata||{})},${sql(item.access_level)})`);
        lines.push(`insert into public.knowledge_sections(id,chapter_id,position,section_type,content,metadata,access_level)
          values(${sql(sectionId)}::uuid,${sql(chapterId)}::uuid,${item.position},${sql(item.section_type)},${json(item.content)},${json(item.metadata||{})},${sql(item.access_level)})
          on conflict(chapter_id,position) do nothing;`);
      });
      lines.push(`do $section_contract$ begin if exists(
        with expected(id,position,section_type,content,metadata,access_level) as (values ${expected.join(',')})
        select 1 from expected
        left join public.knowledge_sections actual on actual.chapter_id=${sql(chapterId)}::uuid and actual.position=expected.position
        where actual.id is distinct from expected.id or actual.section_type is distinct from expected.section_type
           or actual.content is distinct from expected.content or actual.metadata is distinct from expected.metadata
           or actual.access_level is distinct from expected.access_level
      ) then raise exception 'chapter ${chapter.chapter_number||chapter.position} section contract drift' using errcode='P0001'; end if; end $section_contract$;`);
    });
  });

  lines.push(`do $verify$
  declare v_publications integer;v_parts integer;v_chapters integer;v_sections integer;
  begin
    select count(*) into v_publications from public.knowledge_publications where id=${sql(publicationId)}::uuid and slug=${sql(publication.slug)} and title=${sql(publication.title)} and version=${sql(publication.version)};
    select count(*) into v_parts from public.knowledge_parts where publication_id=${sql(publicationId)}::uuid;
    select count(*) into v_chapters from public.knowledge_chapters where publication_id=${sql(publicationId)}::uuid;
    select count(*) into v_sections from public.knowledge_sections section join public.knowledge_chapters chapter on chapter.id=section.chapter_id where chapter.publication_id=${sql(publicationId)}::uuid;
    if v_publications<>1 or v_parts<>${parts.length} or v_chapters<>${chapters.length} or v_sections<>${sections.length} then
      raise exception 'knowledge import count drift: publication %, parts %, chapters %, sections %',v_publications,v_parts,v_chapters,v_sections using errcode='P0001';
    end if;
    if exists(select 1 from public.knowledge_sections section join public.knowledge_chapters chapter on chapter.id=section.chapter_id where chapter.publication_id=${sql(publicationId)}::uuid and coalesce(section.metadata->>'source_hash','') !~ '^[0-9a-f]{64}$') then raise exception 'knowledge import section hash missing' using errcode='P0001'; end if;
  end $verify$;`);
  lines.push('commit;','');
  return {sql:lines.join('\n'),counts:{publications:1,parts:parts.length,chapters:chapters.length,sections:sections.length},publicationId};
}

try{
  const args=parseArgs(process.argv);
  if(!args.input||!args.output)fail('usage: --input <protected.json> --output <protected.sql>');
  const document=validateKnowledgeDocument(JSON.parse(fs.readFileSync(path.resolve(args.input),'utf8'))),result=build(document),output=protectedOutput(args.output);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,result.sql,{encoding:'utf8',mode:0o600});fs.chmodSync(output,0o600);
  console.log(`knowledge-import-sql: prepared (${result.counts.parts} parts, ${result.counts.chapters} chapters, ${result.counts.sections} sections; protected output)`);
}catch(error){console.error(`knowledge-import-sql: ${error.message}`);process.exitCode=1}
