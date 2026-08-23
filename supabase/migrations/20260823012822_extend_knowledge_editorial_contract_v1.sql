begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:knowledge-editorial-contract-v1', 0));

do $editorial_preflight$
declare
  v_type_definition text;
  v_sample_policy text;
begin
  if to_regclass('public.knowledge_sections') is null
     or to_regprocedure('public.knowledge_section_content_valid_v1(text,jsonb)') is null
     or to_regprocedure('public.knowledge_section_metadata_valid_v1(jsonb)') is null
     or to_regprocedure('public.knowledge_section_search_text_v1(text,jsonb)') is null then
    raise exception 'knowledge editorial contract requires Knowledge Area V1' using errcode='P0001';
  end if;

  select lower(pg_get_constraintdef(oid)) into v_type_definition
  from pg_constraint
  where conrelid='public.knowledge_sections'::regclass
    and conname='knowledge_sections_type_check'
    and contype='c';

  if v_type_definition is null or exists(
    select 1 from unnest(array['paragraph','heading','quote','highlight','list','table','exercise','warning','image','separator']) expected_type
    where v_type_definition not like '%'||expected_type||'%'
  ) or (v_type_definition like '%subheading%' and exists(
    select 1 from unnest(array['exercise_black','chapter_checklist','rule_black','impact_phrase','transition','callout','example']) expected_type
    where v_type_definition not like '%'||expected_type||'%'
  )) then
    raise exception 'knowledge editorial contract: incompatible section type constraint' using errcode='P0001';
  end if;

  select lower(qual) into v_sample_policy
  from pg_policies
  where schemaname='public' and tablename='knowledge_sections'
    and policyname='knowledge_sections_sample_read';

  if v_sample_policy is null
     or v_sample_policy not like '%access_level%public%sample%'
     or v_sample_policy not like '%chapter.active%publication.status%published%'
  then
    raise exception 'knowledge editorial contract: incompatible sample policy' using errcode='P0001';
  end if;

  if v_type_definition like '%subheading%' and (
    exists(
      select 1 from unnest(array['exercise_black','chapter_checklist','rule_black','impact_phrase']) required_fragment
      where lower(pg_get_functiondef('public.knowledge_section_content_valid_v1(text,jsonb)'::regprocedure)) not like '%'||required_fragment||'%'
    )
    or exists(
      select 1 from unnest(array['component_type','source_scope','source_hash']) required_fragment
      where lower(pg_get_functiondef('public.knowledge_section_metadata_valid_v1(jsonb)'::regprocedure)) not like '%'||required_fragment||'%'
    )
    or exists(
      select 1 from unnest(array['impact_phrase','exercise_black','chapter_checklist']) required_fragment
      where lower(pg_get_functiondef('public.knowledge_section_search_text_v1(text,jsonb)'::regprocedure)) not like '%'||required_fragment||'%'
    )
  ) then
    raise exception 'knowledge editorial contract: incompatible helper functions' using errcode='P0001';
  end if;
end
$editorial_preflight$;

create or replace function public.knowledge_section_content_valid_v1(
  p_section_type text,
  p_content jsonb
) returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
declare
  v_column_count integer;
begin
  if p_section_type not in (
       'paragraph','heading','subheading','quote','highlight','list','table',
       'exercise','exercise_black','checklist','chapter_checklist','rule_black',
       'impact_phrase','separator','transition','callout','example','warning','image'
     )
     or jsonb_typeof(p_content)<>'object'
     or p_content ? 'html'
     or pg_column_size(p_content)>131072 then
    return false;
  end if;

  if p_section_type in (
    'paragraph','heading','subheading','quote','highlight','warning',
    'rule_black','impact_phrase','transition','callout'
  ) then
    return jsonb_typeof(p_content->'text')='string'
      and length(btrim(p_content->>'text'))>0;
  elsif p_section_type in ('list','checklist','chapter_checklist') then
    return jsonb_typeof(p_content->'items')='array'
      and jsonb_array_length(p_content->'items')>0
      and not exists(
        select 1 from jsonb_array_elements(p_content->'items') item
        where jsonb_typeof(item)<>'string' or length(btrim(item #>> '{}'))=0
      );
  elsif p_section_type='table' then
    if jsonb_typeof(p_content->'columns')<>'array'
       or jsonb_typeof(p_content->'rows')<>'array'
       or jsonb_array_length(p_content->'columns')=0
       or exists(
         select 1 from jsonb_array_elements(p_content->'columns') item
         where jsonb_typeof(item)<>'string' or length(btrim(item #>> '{}'))=0
       ) then
      return false;
    end if;
    v_column_count=jsonb_array_length(p_content->'columns');
    return not exists(
      select 1 from jsonb_array_elements(p_content->'rows') row_value
      where jsonb_typeof(row_value)<>'array'
         or jsonb_array_length(row_value)<>v_column_count
         or exists(
           select 1 from jsonb_array_elements(row_value) cell
           where jsonb_typeof(cell)<>'string'
         )
    );
  elsif p_section_type in ('exercise','exercise_black','example') then
    return jsonb_typeof(p_content->'prompt')='string'
      and length(btrim(p_content->>'prompt'))>0
      and (not (p_content ? 'steps') or (
        jsonb_typeof(p_content->'steps')='array'
        and not exists(
          select 1 from jsonb_array_elements(p_content->'steps') item
          where jsonb_typeof(item)<>'string' or length(btrim(item #>> '{}'))=0
        )
      ));
  elsif p_section_type='image' then
    return jsonb_typeof(p_content->'asset_path')='string'
      and jsonb_typeof(p_content->'alt')='string'
      and p_content->>'asset_path' ~ '^[A-Za-z0-9][A-Za-z0-9_./-]*$'
      and p_content->>'asset_path' !~ '(^|/)\.\.(/|$)'
      and p_content->>'asset_path' !~ '^[A-Za-z]+:';
  end if;

  return p_section_type='separator' and p_content='{}'::jsonb;
end
$function$;

create or replace function public.knowledge_section_metadata_valid_v1(p_metadata jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  select jsonb_typeof(p_metadata)='object'
    and pg_column_size(p_metadata)<=16384
    and not exists(
      select 1 from jsonb_object_keys(p_metadata) key
      where key not in (
        'variant','label','credit','layout','difficulty','locale',
        'component_type','source_scope','source_page','editorial_role','source_hash'
      )
    )
    and (not (p_metadata ? 'source_page') or (
      jsonb_typeof(p_metadata->'source_page')='number'
      and p_metadata->>'source_page' ~ '^[1-9][0-9]*$'
    ))
    and (not (p_metadata ? 'source_hash') or (
      jsonb_typeof(p_metadata->'source_hash')='string'
      and p_metadata->>'source_hash' ~ '^[0-9a-f]{64}$'
    ))
$function$;

create or replace function public.knowledge_section_search_text_v1(p_section_type text,p_content jsonb)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  select case
    when p_section_type in (
      'paragraph','heading','subheading','quote','highlight','warning',
      'rule_black','impact_phrase','transition','callout'
    ) then coalesce(p_content->>'text','')
    when p_section_type in ('list','checklist','chapter_checklist') then
      coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(p_content->'items')), '')
    when p_section_type='table' then concat_ws(' ',
      coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(p_content->'columns')), ''),
      coalesce((
        select string_agg(cell #>> '{}',' ')
        from jsonb_array_elements(p_content->'rows') row_value
        cross join lateral jsonb_array_elements(row_value) cell
      ), '')
    )
    when p_section_type in ('exercise','exercise_black','example') then concat_ws(' ',
      p_content->>'prompt',
      coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(coalesce(p_content->'steps','[]'::jsonb))), '')
    )
    when p_section_type='image' then concat_ws(' ',p_content->>'alt',p_content->>'caption')
    else ''
  end
$function$;

alter table public.knowledge_sections drop constraint knowledge_sections_type_check;
alter table public.knowledge_sections add constraint knowledge_sections_type_check check(section_type in(
  'paragraph','heading','subheading','quote','highlight','list','table',
  'exercise','exercise_black','checklist','chapter_checklist','rule_black',
  'impact_phrase','separator','transition','callout','example','warning','image'
));

drop policy knowledge_sections_sample_read on public.knowledge_sections;
create policy knowledge_sections_sample_read on public.knowledge_sections
for select to anon,authenticated using(
  access_level in('public','sample') and exists(
    select 1
    from public.knowledge_chapters chapter
    join public.knowledge_publications publication on publication.id=chapter.publication_id
    where chapter.id=chapter_id and chapter.active
      and publication.status='published'
      and publication.published_at<=statement_timestamp()
  )
);

do $editorial_final_contract$
declare
  v_type_definition text;
  v_sample_policy text;
begin
  select lower(pg_get_constraintdef(oid)) into v_type_definition
  from pg_constraint
  where conrelid='public.knowledge_sections'::regclass
    and conname='knowledge_sections_type_check';

  if exists(
       select 1 from unnest(array['subheading','exercise_black','chapter_checklist','rule_black','impact_phrase','transition','callout','example']) expected_type
       where v_type_definition not like '%'||expected_type||'%'
     )
     or not public.knowledge_section_content_valid_v1('rule_black','{"text":"ok"}'::jsonb)
     or not public.knowledge_section_content_valid_v1('chapter_checklist','{"items":["ok"]}'::jsonb)
     or public.knowledge_section_content_valid_v1('table','{"columns":["a","b"],"rows":[["a"]]}'::jsonb)
     or public.knowledge_section_content_valid_v1('paragraph','{"html":"<b>unsafe</b>","text":"x"}'::jsonb)
  then
    raise exception 'knowledge editorial contract: final validator differs' using errcode='P0001';
  end if;

  select lower(qual) into v_sample_policy
  from pg_policies
  where schemaname='public' and tablename='knowledge_sections'
    and policyname='knowledge_sections_sample_read';

  if v_sample_policy is null
     or v_sample_policy like '%chapter.access_level%'
     or v_sample_policy not like '%access_level%public%sample%chapter.active%publication.status%published%'
  then
    raise exception 'knowledge editorial contract: final sample policy differs' using errcode='P0001';
  end if;

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in(
        'knowledge_section_content_valid_v1',
        'knowledge_section_metadata_valid_v1',
        'knowledge_section_search_text_v1'
      )
      and (p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog'])
  ) then
    raise exception 'knowledge editorial contract: helper security differs' using errcode='P0001';
  end if;
end
$editorial_final_contract$;

commit;
