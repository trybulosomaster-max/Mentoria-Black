begin;
create extension if not exists pgtap;
select no_plan();

select is((select count(*) from pg_class where oid in(
  'public.knowledge_publications'::regclass,'public.knowledge_parts'::regclass,
  'public.knowledge_chapters'::regclass,'public.knowledge_sections'::regclass,
  'public.knowledge_progress'::regclass,'public.knowledge_bookmarks'::regclass
) and relrowsecurity),6::bigint,'all Knowledge tables have RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename like 'knowledge_%'),13::bigint,'canonical Knowledge policy set exists');
select ok(not (select prosecdef from pg_proc where oid='public.search_my_knowledge_v1(text,integer)'::regprocedure),'search is security invoker');
select ok(not (select prosecdef from pg_proc where oid='public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean)'::regprocedure),'progress RPC is security invoker');
select ok(not (select prosecdef from pg_proc where oid='public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean)'::regprocedure),'bookmark RPC is security invoker');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name like 'knowledge_%' and grantee in('anon','authenticated') and privilege_type in('TRUNCATE','TRIGGER','REFERENCES')),0::bigint,'clients have no dangerous grants');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in('knowledge_publications','knowledge_parts','knowledge_chapters','knowledge_sections') and grantee in('anon','authenticated') and privilege_type<>'SELECT'),0::bigint,'catalog is read-only to clients');
select is((select count(*) from pg_indexes where schemaname='public' and indexname='knowledge_sections_search_idx'),1::bigint,'search GIN index exists');

insert into auth.users(id,email,email_confirmed_at) values
 ('91000000-0000-4000-8000-000000000001','sample@example.invalid',clock_timestamp()),
 ('91000000-0000-4000-8000-000000000002','knowledge@example.invalid',clock_timestamp()),
 ('91000000-0000-4000-8000-000000000003','revoked@example.invalid',clock_timestamp()),
 ('91000000-0000-4000-8000-000000000004','complete@example.invalid',clock_timestamp());
set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000001';
select is((select result from public.start_my_app_trial()),'started','trial APP starts independently from Knowledge');
reset role;
insert into public.access_grants(user_id,product_id,status,source,access_type,environment,started_at)
select '91000000-0000-4000-8000-000000000002',id,'active','manual','lifetime','legacy',clock_timestamp() from public.products where code='KNOWLEDGE';
insert into public.access_grants(user_id,product_id,status,source,access_type,environment,started_at,revoked_at)
select '91000000-0000-4000-8000-000000000003',id,'revoked','manual','lifetime','legacy',clock_timestamp(),clock_timestamp() from public.products where code='KNOWLEDGE';
insert into public.access_grants(user_id,product_id,status,source,access_type,environment,started_at)
select '91000000-0000-4000-8000-000000000004',id,'active','manual',case when code='KNOWLEDGE' then 'lifetime' else 'paid' end,'legacy',clock_timestamp()
from public.products where code in('APP','KNOWLEDGE');

set local role anon;
select is((select count(*) from public.knowledge_sections),3::bigint,'anon receives sample sections only');
select is((select count(*) from public.knowledge_chapters),3::bigint,'anon may see safe chapter titles and structure');
select is((select count(*) from public.search_my_knowledge_v1('protegido',20)),0::bigint,'anonymous search leaks no protected snippet');
select throws_ok($$insert into public.knowledge_progress(user_id,publication_id,chapter_id) values('91000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')$$,'42501',null,'anon cannot write progress');
reset role;

set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000001';
select is((select count(*) from public.knowledge_sections),3::bigint,'APP/no KNOWLEDGE receives sample only');
select is((select count(*) from public.search_my_knowledge_v1('Conteúdo sintético protegido',20)),0::bigint,'unauthorized search leaks no protected body');
select lives_ok($$select public.save_my_knowledge_progress_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',40,'84000000-0000-4000-8000-000000000002',false)$$,'sample progress saves');
select lives_ok($$select public.set_my_knowledge_bookmark_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',null,true)$$,'sample bookmark saves');
select throws_ok($$update public.knowledge_bookmarks set chapter_id='83000000-0000-4000-8000-000000000002' where user_id=auth.uid()$$,'42501',null,'bookmark update cannot cross into protected content');
select throws_ok($$select public.save_my_knowledge_progress_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',40,null,false)$$,'42501',null,'protected progress is blocked without KNOWLEDGE');
select throws_ok($$insert into public.knowledge_progress(user_id,publication_id,chapter_id) values('91000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')$$,'42501',null,'cross-user progress is blocked');
reset role;

set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000002';
select is((select count(*) from public.knowledge_sections),9::bigint,'KNOWLEDGE entitlement receives full synthetic publication');
select is((select count(*) from public.search_my_knowledge_v1('Conteúdo sintético protegido',20)),1::bigint,'authorized search returns protected result');
select lives_ok($$select public.save_my_knowledge_progress_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',100,'84000000-0000-4000-8000-000000000006',true)$$,'protected progress saves for entitled user');
select lives_ok($$select public.set_my_knowledge_bookmark_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',null,true)$$,'bookmark adds');
select lives_ok($$select public.set_my_knowledge_bookmark_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',null,true)$$,'bookmark retry is idempotent');
select is((select count(*) from public.knowledge_bookmarks),1::bigint,'bookmark is not duplicated and another user remains hidden');
select lives_ok($$select public.set_my_knowledge_bookmark_v1('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',null,false)$$,'bookmark removes');
select is((select count(*) from public.knowledge_bookmarks),0::bigint,'bookmark removal affects only the caller');
reset role;

set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000003';
select is((select count(*) from public.knowledge_sections),3::bigint,'revoked KNOWLEDGE falls back to sample');
reset role;

set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000004';
select is((select count(*) from public.knowledge_sections),9::bigint,'COMPLETE grants the independent KNOWLEDGE body');
reset role;
update public.access_grants set status='revoked',revoked_at=clock_timestamp() where user_id='91000000-0000-4000-8000-000000000004' and product_id=(select id from public.products where code='APP');
set local role authenticated;set local request.jwt.claim.sub='91000000-0000-4000-8000-000000000004';
select is((select count(*) from public.knowledge_sections),9::bigint,'APP cancellation does not revoke lifetime KNOWLEDGE');
reset role;

select is((select count(*) from public.knowledge_progress where user_id='91000000-0000-4000-8000-000000000002' and progress_percent=100 and completed_at is not null),1::bigint,'server stores chapter completion');
select is((select count(*) from public.knowledge_progress where user_id='91000000-0000-4000-8000-000000000001'),1::bigint,'progress is preserved independently of entitlement');
select throws_ok($$insert into public.knowledge_sections(chapter_id,position,section_type,content,access_level) values('83000000-0000-4000-8000-000000000002',99,'paragraph','{"html":"<script>bad()</script>"}','knowledge')$$,'23514',null,'arbitrary HTML is rejected');

select * from finish();
rollback;
