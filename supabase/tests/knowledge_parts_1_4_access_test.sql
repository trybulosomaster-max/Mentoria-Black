begin;
create extension if not exists pgtap;
select plan(23);

create temp table knowledge_probe(word text not null);
insert into knowledge_probe(word)
select token
from public.knowledge_sections protected
cross join lateral regexp_split_to_table(public.knowledge_section_search_text_v1(protected.section_type,protected.content),'[^[:alnum:]À-ÿ]+') token
where protected.access_level='knowledge'
  and length(token)>4
  and not exists(
    select 1 from public.knowledge_sections sample
    where sample.access_level in('public','sample')
      and sample.search_vector@@websearch_to_tsquery('portuguese',token)
  )
  and exists(select 1 from public.search_my_knowledge_v1(token,50) result where result.access_level='knowledge')
limit 1;
grant select on knowledge_probe to anon,authenticated;
select is((select count(*) from knowledge_probe),1::bigint,'protected search probe exists');

set local role anon;
select is((select count(*) from public.knowledge_sections),:'expected_sample'::bigint,'anon sees sample only');
select throws_ok($$insert into public.knowledge_progress(user_id,publication_id,chapter_id) select '10000000-0000-0000-0000-000000000001'::uuid,publication_id,id from public.knowledge_chapters limit 1$$,'42501',null,'anon cannot write progress');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_sample'::bigint,'APP trial sees sample only');
select is((select count(*) from public.search_my_knowledge_v1((select word from knowledge_probe),50) where access_level='knowledge'),0::bigint,'APP trial search leaks no protected snippet');
select ok((select public.has_active_access('APP')),'APP trial is active');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_sample'::bigint,'APP paid sees sample only');
select ok((select public.has_active_access('APP')),'APP paid is active');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_total'::bigint,'KNOWLEDGE user sees all sections');
select ok((select count(*) from public.search_my_knowledge_v1((select word from knowledge_probe),50) where access_level='knowledge')>0,'KNOWLEDGE search returns protected content');
select ok((select public.has_active_access('KNOWLEDGE')),'KNOWLEDGE entitlement is active');
select lives_ok($$select public.save_my_knowledge_progress_v1(publication_id,id,10,null,false) from public.knowledge_chapters where access_level='knowledge' order by position limit 1$$,'KNOWLEDGE user saves progress');
select lives_ok($$select public.set_my_knowledge_bookmark_v1(publication_id,id,null,true) from public.knowledge_chapters where access_level='knowledge' order by position limit 1$$,'KNOWLEDGE user saves bookmark');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_total'::bigint,'COMPLETE user sees all sections');
select ok((select public.has_active_access('APP')),'COMPLETE keeps APP grant independent');
select ok((select public.has_active_access('KNOWLEDGE')),'COMPLETE keeps KNOWLEDGE grant independent');
select is((select count(*) from public.knowledge_progress where user_id='10000000-0000-0000-0000-000000000002'::uuid),0::bigint,'progress is cross-user isolated');
select is((select count(*) from public.knowledge_bookmarks where user_id='10000000-0000-0000-0000-000000000002'::uuid),0::bigint,'bookmarks are cross-user isolated');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_sample'::bigint,'revoked KNOWLEDGE sees sample only');
select is((select public.has_active_access('KNOWLEDGE')),false,'revoked KNOWLEDGE is inactive');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
set local role authenticated;
select is((select count(*) from public.knowledge_sections),:'expected_sample'::bigint,'user without grant sees sample only');
select is((select public.has_active_access('KNOWLEDGE')),false,'user without grant has no KNOWLEDGE');
select throws_ok($$insert into public.knowledge_bookmarks(user_id,publication_id,chapter_id) select '10000000-0000-0000-0000-000000000005'::uuid,publication_id,id from public.knowledge_chapters where access_level='knowledge' limit 1$$,'42501',null,'user without grant cannot bookmark protected chapter');
reset role;

select * from finish();
rollback;
