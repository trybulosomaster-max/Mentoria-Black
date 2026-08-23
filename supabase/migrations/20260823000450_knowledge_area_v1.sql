begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:knowledge-area-v1', 0));

do $knowledge_preflight$
declare
  v_table_count integer;
  v_function_count integer;
  v_named_function_count integer;
begin
  if to_regclass('public.products') is null
     or to_regprocedure('public.has_active_access(text)') is null then
    raise exception 'knowledge area v1 requires Commercial Access V2' using errcode = 'P0001';
  end if;

  select count(*) into v_table_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname in (
      'knowledge_publications', 'knowledge_parts', 'knowledge_chapters',
      'knowledge_sections', 'knowledge_progress', 'knowledge_bookmarks'
    );

  select count(*) into v_function_count
  from unnest(array[
    to_regprocedure('public.knowledge_section_content_valid_v1(text,jsonb)'),
    to_regprocedure('public.knowledge_section_metadata_valid_v1(jsonb)'),
    to_regprocedure('public.knowledge_section_search_text_v1(text,jsonb)'),
    to_regprocedure('public.search_my_knowledge_v1(text,integer)'),
    to_regprocedure('public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean)'),
    to_regprocedure('public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean)')
  ]) signature
  where signature is not null;

  select count(*) into v_named_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'knowledge_section_content_valid_v1', 'knowledge_section_metadata_valid_v1',
      'knowledge_section_search_text_v1', 'search_my_knowledge_v1',
      'save_my_knowledge_progress_v1', 'set_my_knowledge_bookmark_v1'
    );

  if v_named_function_count<>v_function_count
     or v_table_count not in (0, 6)
     or (v_table_count = 0 and v_function_count <> 0) then
    raise exception 'knowledge area v1 drift: unknown or partial schema' using errcode = 'P0001';
  end if;

  if v_table_count = 6 then
    if exists (
      with expected(table_name, column_name, udt_name, nullable) as (
        values
          ('knowledge_publications','id','uuid',false),
          ('knowledge_publications','slug','text',false),
          ('knowledge_publications','title','text',false),
          ('knowledge_publications','subtitle','text',true),
          ('knowledge_publications','description','text',true),
          ('knowledge_publications','author','text',true),
          ('knowledge_publications','cover_path','text',true),
          ('knowledge_publications','publication_type','text',false),
          ('knowledge_publications','status','text',false),
          ('knowledge_publications','version','text',false),
          ('knowledge_publications','required_product_code','text',false),
          ('knowledge_publications','published_at','timestamptz',true),
          ('knowledge_publications','created_at','timestamptz',false),
          ('knowledge_publications','updated_at','timestamptz',false),
          ('knowledge_parts','id','uuid',false),
          ('knowledge_parts','publication_id','uuid',false),
          ('knowledge_parts','position','int4',false),
          ('knowledge_parts','title','text',false),
          ('knowledge_parts','created_at','timestamptz',false),
          ('knowledge_parts','updated_at','timestamptz',false),
          ('knowledge_chapters','id','uuid',false),
          ('knowledge_chapters','publication_id','uuid',false),
          ('knowledge_chapters','part_id','uuid',false),
          ('knowledge_chapters','slug','text',false),
          ('knowledge_chapters','position','int4',false),
          ('knowledge_chapters','title','text',false),
          ('knowledge_chapters','subtitle','text',true),
          ('knowledge_chapters','excerpt','text',true),
          ('knowledge_chapters','access_level','text',false),
          ('knowledge_chapters','estimated_read_minutes','int4',false),
          ('knowledge_chapters','active','bool',false),
          ('knowledge_chapters','created_at','timestamptz',false),
          ('knowledge_chapters','updated_at','timestamptz',false),
          ('knowledge_sections','id','uuid',false),
          ('knowledge_sections','chapter_id','uuid',false),
          ('knowledge_sections','position','int4',false),
          ('knowledge_sections','section_type','text',false),
          ('knowledge_sections','content','jsonb',false),
          ('knowledge_sections','metadata','jsonb',false),
          ('knowledge_sections','access_level','text',false),
          ('knowledge_sections','search_vector','tsvector',true),
          ('knowledge_sections','created_at','timestamptz',false),
          ('knowledge_sections','updated_at','timestamptz',false),
          ('knowledge_progress','user_id','uuid',false),
          ('knowledge_progress','publication_id','uuid',false),
          ('knowledge_progress','chapter_id','uuid',false),
          ('knowledge_progress','progress_percent','numeric',false),
          ('knowledge_progress','last_section_id','uuid',true),
          ('knowledge_progress','last_read_at','timestamptz',false),
          ('knowledge_progress','completed_at','timestamptz',true),
          ('knowledge_progress','created_at','timestamptz',false),
          ('knowledge_progress','updated_at','timestamptz',false),
          ('knowledge_bookmarks','id','uuid',false),
          ('knowledge_bookmarks','user_id','uuid',false),
          ('knowledge_bookmarks','publication_id','uuid',false),
          ('knowledge_bookmarks','chapter_id','uuid',false),
          ('knowledge_bookmarks','section_id','uuid',true),
          ('knowledge_bookmarks','created_at','timestamptz',false)
      )
      select 1
      from expected e
      left join information_schema.columns c
        on c.table_schema = 'public'
       and c.table_name = e.table_name
       and c.column_name = e.column_name
      where c.column_name is null
         or c.udt_name <> e.udt_name
         or (c.is_nullable = 'YES') <> e.nullable
    ) then
      raise exception 'knowledge area v1 drift: table columns differ' using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from (
        select table_name, count(*)::integer as column_count
        from information_schema.columns
        where table_schema='public'
          and table_name in (
            'knowledge_publications', 'knowledge_parts', 'knowledge_chapters',
            'knowledge_sections', 'knowledge_progress', 'knowledge_bookmarks'
          )
        group by table_name
      ) actual
      join (values
        ('knowledge_publications',14), ('knowledge_parts',6), ('knowledge_chapters',13),
        ('knowledge_sections',10), ('knowledge_progress',9), ('knowledge_bookmarks',6)
      ) expected(table_name,column_count) using(table_name)
      where actual.column_count <> expected.column_count
    ) then
      raise exception 'knowledge area v1 drift: unexpected table columns' using errcode = 'P0001';
    end if;

    if v_function_count not in (0, 6) then
      raise exception 'knowledge area v1 drift: partial function contract' using errcode = 'P0001';
    end if;

    if v_function_count = 6 and exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('search_my_knowledge_v1','save_my_knowledge_progress_v1','set_my_knowledge_bookmark_v1')
        and (p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog, public'])
    ) then
      raise exception 'knowledge area v1 drift: RPC security contract differs' using errcode = 'P0001';
    end if;

    if v_function_count=6 and (
      lower(pg_get_functiondef('public.knowledge_section_content_valid_v1(text,jsonb)'::regprocedure)) not like '%p_content ? ''html''%'
      or lower(pg_get_functiondef('public.knowledge_section_content_valid_v1(text,jsonb)'::regprocedure)) not like '%exercise%separator%'
      or lower(pg_get_functiondef('public.knowledge_section_metadata_valid_v1(jsonb)'::regprocedure)) not like '%difficulty%locale%'
      or lower(pg_get_functiondef('public.knowledge_section_search_text_v1(text,jsonb)'::regprocedure)) not like '%jsonb_array_elements%'
      or lower(pg_get_functiondef('public.search_my_knowledge_v1(text,integer)'::regprocedure)) not like '%websearch_to_tsquery%'
      or lower(pg_get_functiondef('public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean)'::regprocedure)) not like '%auth.uid()%has_active_access%on conflict%'
      or lower(pg_get_functiondef('public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean)'::regprocedure)) not like '%auth.uid()%has_active_access%on conflict%'
    ) then
      raise exception 'knowledge area v1 drift: function semantics differ' using errcode = 'P0001';
    end if;
  end if;
end
$knowledge_preflight$;

create or replace function public.knowledge_section_content_valid_v1(
  p_section_type text,
  p_content jsonb
) returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $function$
begin
  if p_section_type not in ('paragraph','heading','quote','highlight','list','table','exercise','warning','image','separator')
     or jsonb_typeof(p_content) <> 'object'
     or p_content ? 'html'
     or pg_column_size(p_content) > 131072 then
    return false;
  end if;

  if p_section_type in ('paragraph','heading','quote','highlight','warning') then
    return jsonb_typeof(p_content->'text')='string' and length(btrim(p_content->>'text'))>0;
  elsif p_section_type='list' then
    return jsonb_typeof(p_content->'items')='array'
      and jsonb_array_length(p_content->'items')>0
      and not exists(select 1 from jsonb_array_elements(p_content->'items') item where jsonb_typeof(item)<>'string');
  elsif p_section_type='table' then
    return jsonb_typeof(p_content->'columns')='array'
      and jsonb_typeof(p_content->'rows')='array'
      and jsonb_array_length(p_content->'columns')>0
      and not exists(select 1 from jsonb_array_elements(p_content->'columns') item where jsonb_typeof(item)<>'string')
      and not exists(select 1 from jsonb_array_elements(p_content->'rows') row_value where jsonb_typeof(row_value)<>'array');
  elsif p_section_type='exercise' then
    return jsonb_typeof(p_content->'prompt')='string'
      and length(btrim(p_content->>'prompt'))>0
      and (not (p_content ? 'steps') or (
        jsonb_typeof(p_content->'steps')='array'
        and not exists(select 1 from jsonb_array_elements(p_content->'steps') item where jsonb_typeof(item)<>'string')
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
      where key not in ('variant','label','credit','layout','difficulty','locale')
    )
$function$;

create or replace function public.knowledge_section_search_text_v1(p_section_type text,p_content jsonb)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  select case
    when p_section_type in ('paragraph','heading','quote','highlight','warning') then coalesce(p_content->>'text','')
    when p_section_type='list' then coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(p_content->'items')), '')
    when p_section_type='table' then concat_ws(' ',
      coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(p_content->'columns')), ''),
      coalesce((select string_agg(cell #>> '{}',' ') from jsonb_array_elements(p_content->'rows') row_value cross join lateral jsonb_array_elements(row_value) cell), '')
    )
    when p_section_type='exercise' then concat_ws(' ',p_content->>'prompt',coalesce((select string_agg(value #>> '{}',' ') from jsonb_array_elements(coalesce(p_content->'steps','[]'::jsonb))),''))
    when p_section_type='image' then concat_ws(' ',p_content->>'alt',p_content->>'caption')
    else ''
  end
$function$;

create table if not exists public.knowledge_publications (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  subtitle text,
  description text,
  author text,
  cover_path text,
  publication_type text not null default 'book',
  status text not null default 'draft',
  version text not null default '1.0',
  required_product_code text not null default 'KNOWLEDGE',
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_publications_slug_key unique(slug),
  constraint knowledge_publications_slug_format check(slug~'^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint knowledge_publications_type_check check(publication_type in('book','course','material','exercise_collection')),
  constraint knowledge_publications_status_check check(status in('draft','published','archived')),
  constraint knowledge_publications_publish_check check(status<>'published' or published_at is not null),
  constraint knowledge_publications_product_fkey foreign key(required_product_code) references public.products(code) on update restrict on delete restrict
);

create table if not exists public.knowledge_parts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.knowledge_publications(id) on delete cascade,
  position integer not null,
  title text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_parts_position_check check(position>0),
  constraint knowledge_parts_publication_position_key unique(publication_id,position),
  constraint knowledge_parts_id_publication_key unique(id,publication_id)
);

create table if not exists public.knowledge_chapters (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.knowledge_publications(id) on delete cascade,
  part_id uuid not null,
  slug text not null,
  position integer not null,
  title text not null,
  subtitle text,
  excerpt text,
  access_level text not null default 'knowledge',
  estimated_read_minutes integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_chapters_part_publication_fkey foreign key(part_id,publication_id) references public.knowledge_parts(id,publication_id) on delete cascade,
  constraint knowledge_chapters_slug_format check(slug~'^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint knowledge_chapters_position_check check(position>0),
  constraint knowledge_chapters_read_time_check check(estimated_read_minutes between 1 and 1440),
  constraint knowledge_chapters_access_check check(access_level in('public','sample','knowledge')),
  constraint knowledge_chapters_publication_slug_key unique(publication_id,slug),
  constraint knowledge_chapters_part_position_key unique(part_id,position),
  constraint knowledge_chapters_id_publication_key unique(id,publication_id)
);

create table if not exists public.knowledge_sections (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.knowledge_chapters(id) on delete cascade,
  position integer not null,
  section_type text not null,
  content jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  access_level text not null default 'knowledge',
  search_vector tsvector generated always as (
    to_tsvector('portuguese',public.knowledge_section_search_text_v1(section_type,content))
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_sections_position_check check(position>0),
  constraint knowledge_sections_type_check check(section_type in('paragraph','heading','quote','highlight','list','table','exercise','warning','image','separator')),
  constraint knowledge_sections_access_check check(access_level in('public','sample','knowledge')),
  constraint knowledge_sections_content_check check(public.knowledge_section_content_valid_v1(section_type,content)),
  constraint knowledge_sections_metadata_check check(public.knowledge_section_metadata_valid_v1(metadata)),
  constraint knowledge_sections_chapter_position_key unique(chapter_id,position),
  constraint knowledge_sections_id_chapter_key unique(id,chapter_id)
);

create table if not exists public.knowledge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null references public.knowledge_publications(id) on delete cascade,
  chapter_id uuid not null,
  progress_percent numeric(5,2) not null default 0,
  last_section_id uuid,
  last_read_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint knowledge_progress_pkey primary key(user_id,chapter_id),
  constraint knowledge_progress_chapter_publication_fkey foreign key(chapter_id,publication_id) references public.knowledge_chapters(id,publication_id) on delete cascade,
  constraint knowledge_progress_section_chapter_fkey foreign key(last_section_id,chapter_id) references public.knowledge_sections(id,chapter_id) on delete set null (last_section_id),
  constraint knowledge_progress_percent_check check(progress_percent between 0 and 100),
  constraint knowledge_progress_completed_check check(completed_at is null or progress_percent=100)
);

create table if not exists public.knowledge_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null references public.knowledge_publications(id) on delete cascade,
  chapter_id uuid not null,
  section_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint knowledge_bookmarks_chapter_publication_fkey foreign key(chapter_id,publication_id) references public.knowledge_chapters(id,publication_id) on delete cascade,
  constraint knowledge_bookmarks_section_chapter_fkey foreign key(section_id,chapter_id) references public.knowledge_sections(id,chapter_id) on delete cascade
);

create index if not exists knowledge_parts_publication_idx on public.knowledge_parts(publication_id,position);
create index if not exists knowledge_chapters_publication_order_idx on public.knowledge_chapters(publication_id,part_id,position) where active;
create index if not exists knowledge_sections_chapter_order_idx on public.knowledge_sections(chapter_id,position);
create index if not exists knowledge_sections_search_idx on public.knowledge_sections using gin(search_vector);
create index if not exists knowledge_progress_user_publication_idx on public.knowledge_progress(user_id,publication_id,last_read_at desc);
create index if not exists knowledge_bookmarks_user_idx on public.knowledge_bookmarks(user_id,created_at desc);
create unique index if not exists knowledge_bookmarks_target_uidx on public.knowledge_bookmarks(user_id,chapter_id,coalesce(section_id,'00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.knowledge_touch_updated_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  new.updated_at=clock_timestamp();
  return new;
end
$function$;

do $knowledge_triggers$
declare v_table text;
begin
  foreach v_table in array array['knowledge_publications','knowledge_parts','knowledge_chapters','knowledge_sections','knowledge_progress'] loop
    if not exists(select 1 from pg_trigger where tgrelid=format('public.%I',v_table)::regclass and tgname='knowledge_touch_updated_at_v1') then
      execute format('create trigger knowledge_touch_updated_at_v1 before update on public.%I for each row execute function public.knowledge_touch_updated_at_v1()',v_table);
    end if;
  end loop;
end
$knowledge_triggers$;

alter table public.knowledge_publications enable row level security;
alter table public.knowledge_parts enable row level security;
alter table public.knowledge_chapters enable row level security;
alter table public.knowledge_sections enable row level security;
alter table public.knowledge_progress enable row level security;
alter table public.knowledge_bookmarks enable row level security;

do $knowledge_policies$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_publications' and policyname='knowledge_publications_catalog_read') then
    create policy knowledge_publications_catalog_read on public.knowledge_publications for select to anon,authenticated using(status='published' and published_at<=statement_timestamp());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_parts' and policyname='knowledge_parts_catalog_read') then
    create policy knowledge_parts_catalog_read on public.knowledge_parts for select to anon,authenticated using(exists(select 1 from public.knowledge_publications publication where publication.id=publication_id and publication.status='published' and publication.published_at<=statement_timestamp()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_chapters' and policyname='knowledge_chapters_catalog_read') then
    create policy knowledge_chapters_catalog_read on public.knowledge_chapters for select to anon,authenticated using(active and exists(select 1 from public.knowledge_publications publication where publication.id=publication_id and publication.status='published' and publication.published_at<=statement_timestamp()));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_sections' and policyname='knowledge_sections_sample_read') then
    create policy knowledge_sections_sample_read on public.knowledge_sections for select to anon,authenticated using(
      access_level in('public','sample') and exists(
        select 1 from public.knowledge_chapters chapter
        join public.knowledge_publications publication on publication.id=chapter.publication_id
        where chapter.id=chapter_id and chapter.active and chapter.access_level in('public','sample')
          and publication.status='published' and publication.published_at<=statement_timestamp()
      )
    );
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_sections' and policyname='knowledge_sections_entitled_read') then
    create policy knowledge_sections_entitled_read on public.knowledge_sections for select to authenticated using(
      exists(
        select 1 from public.knowledge_chapters chapter
        join public.knowledge_publications publication on publication.id=chapter.publication_id
        where chapter.id=chapter_id and chapter.active
          and publication.status='published' and publication.published_at<=statement_timestamp()
          and (select public.has_active_access('KNOWLEDGE'))
      )
    );
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_progress' and policyname='knowledge_progress_own_read') then
    create policy knowledge_progress_own_read on public.knowledge_progress for select to authenticated using((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_progress' and policyname='knowledge_progress_own_insert') then
    create policy knowledge_progress_own_insert on public.knowledge_progress for insert to authenticated with check((select auth.uid())=user_id and exists(
      select 1 from public.knowledge_chapters chapter join public.knowledge_publications publication on publication.id=chapter.publication_id
      where chapter.id=chapter_id and chapter.publication_id=publication_id and chapter.active and publication.status='published'
        and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
    ));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_progress' and policyname='knowledge_progress_own_update') then
    create policy knowledge_progress_own_update on public.knowledge_progress for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id and exists(
      select 1 from public.knowledge_chapters chapter join public.knowledge_publications publication on publication.id=chapter.publication_id
      where chapter.id=chapter_id and chapter.publication_id=publication_id and chapter.active and publication.status='published'
        and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
    ));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_progress' and policyname='knowledge_progress_own_delete') then
    create policy knowledge_progress_own_delete on public.knowledge_progress for delete to authenticated using((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_bookmarks' and policyname='knowledge_bookmarks_own_read') then
    create policy knowledge_bookmarks_own_read on public.knowledge_bookmarks for select to authenticated using((select auth.uid())=user_id);
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_bookmarks' and policyname='knowledge_bookmarks_own_insert') then
    create policy knowledge_bookmarks_own_insert on public.knowledge_bookmarks for insert to authenticated with check((select auth.uid())=user_id and exists(
      select 1 from public.knowledge_chapters chapter join public.knowledge_publications publication on publication.id=chapter.publication_id
      where chapter.id=chapter_id and chapter.publication_id=publication_id and chapter.active and publication.status='published'
        and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
    ));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_bookmarks' and policyname='knowledge_bookmarks_own_update') then
    create policy knowledge_bookmarks_own_update on public.knowledge_bookmarks for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id and exists(
      select 1 from public.knowledge_chapters chapter join public.knowledge_publications publication on publication.id=chapter.publication_id
      where chapter.id=chapter_id and chapter.publication_id=publication_id and chapter.active and publication.status='published'
        and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
    ));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='knowledge_bookmarks' and policyname='knowledge_bookmarks_own_delete') then
    create policy knowledge_bookmarks_own_delete on public.knowledge_bookmarks for delete to authenticated using((select auth.uid())=user_id);
  end if;
end
$knowledge_policies$;

revoke all privileges on table public.knowledge_publications,public.knowledge_parts,public.knowledge_chapters,
  public.knowledge_sections,public.knowledge_progress,public.knowledge_bookmarks from public,anon,authenticated;
grant select on table public.knowledge_publications,public.knowledge_parts,public.knowledge_chapters,public.knowledge_sections to anon,authenticated;
grant select,insert,update,delete on table public.knowledge_progress,public.knowledge_bookmarks to authenticated;
grant all privileges on table public.knowledge_publications,public.knowledge_parts,public.knowledge_chapters,
  public.knowledge_sections,public.knowledge_progress,public.knowledge_bookmarks to service_role;

create or replace function public.search_my_knowledge_v1(p_query text,p_limit integer default 20)
returns table(
  publication_id uuid,publication_slug text,publication_title text,
  chapter_id uuid,chapter_slug text,chapter_title text,section_id uuid,
  section_type text,access_level text,snippet text,rank real
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $function$
declare v_query tsquery;
begin
  if length(btrim(coalesce(p_query,'')))<2 then return; end if;
  v_query=websearch_to_tsquery('portuguese',left(btrim(p_query),160));
  return query
  select publication.id,publication.slug,publication.title,
    chapter.id,chapter.slug,chapter.title,section.id,section.section_type,section.access_level,
    left(public.knowledge_section_search_text_v1(section.section_type,section.content),240),
    ts_rank(section.search_vector,v_query)
  from public.knowledge_sections section
  join public.knowledge_chapters chapter on chapter.id=section.chapter_id
  join public.knowledge_publications publication on publication.id=chapter.publication_id
  where section.search_vector@@v_query
  order by ts_rank(section.search_vector,v_query) desc,publication.title,chapter.position,section.position
  limit least(greatest(coalesce(p_limit,20),1),50);
end
$function$;

create or replace function public.save_my_knowledge_progress_v1(
  p_publication_id uuid,p_chapter_id uuid,p_progress_percent numeric,
  p_last_section_id uuid default null,p_completed boolean default false
) returns public.knowledge_progress
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare v_user_id uuid=(select auth.uid());v_result public.knowledge_progress;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_progress_percent<0 or p_progress_percent>100 then raise exception 'invalid progress' using errcode='22023'; end if;
  if not exists(
    select 1 from public.knowledge_chapters chapter
    join public.knowledge_publications publication on publication.id=chapter.publication_id
    where chapter.id=p_chapter_id and chapter.publication_id=p_publication_id and chapter.active and publication.status='published'
      and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
  ) then raise exception 'chapter access denied' using errcode='42501'; end if;

  insert into public.knowledge_progress(user_id,publication_id,chapter_id,progress_percent,last_section_id,last_read_at,completed_at)
  values(v_user_id,p_publication_id,p_chapter_id,case when p_completed then 100 else p_progress_percent end,p_last_section_id,clock_timestamp(),case when p_completed then clock_timestamp() end)
  on conflict(user_id,chapter_id) do update set
    publication_id=excluded.publication_id,
    progress_percent=excluded.progress_percent,
    last_section_id=excluded.last_section_id,
    last_read_at=excluded.last_read_at,
    completed_at=case when p_completed then coalesce(knowledge_progress.completed_at,clock_timestamp()) else null end
  returning * into v_result;
  return v_result;
end
$function$;

create or replace function public.set_my_knowledge_bookmark_v1(
  p_publication_id uuid,p_chapter_id uuid,p_section_id uuid default null,p_enabled boolean default true
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare v_user_id uuid=(select auth.uid());
begin
  if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.knowledge_chapters chapter
    join public.knowledge_publications publication on publication.id=chapter.publication_id
    where chapter.id=p_chapter_id and chapter.publication_id=p_publication_id and chapter.active and publication.status='published'
      and (chapter.access_level in('public','sample') or (select public.has_active_access('KNOWLEDGE')))
      and (p_section_id is null or exists(select 1 from public.knowledge_sections section where section.id=p_section_id and section.chapter_id=chapter.id))
  ) then raise exception 'bookmark target access denied' using errcode='42501'; end if;

  if p_enabled then
    insert into public.knowledge_bookmarks(user_id,publication_id,chapter_id,section_id)
    values(v_user_id,p_publication_id,p_chapter_id,p_section_id)
    on conflict(user_id,chapter_id,(coalesce(section_id,'00000000-0000-0000-0000-000000000000'::uuid))) do nothing;
  else
    delete from public.knowledge_bookmarks
    where user_id=v_user_id and chapter_id=p_chapter_id and section_id is not distinct from p_section_id;
  end if;
  return p_enabled;
end
$function$;

revoke all on function public.knowledge_section_content_valid_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.knowledge_section_metadata_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.knowledge_section_search_text_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.knowledge_touch_updated_at_v1() from public,anon,authenticated;
revoke all on function public.search_my_knowledge_v1(text,integer) from public;
revoke all on function public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean) from public,anon;
revoke all on function public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.search_my_knowledge_v1(text,integer) to anon,authenticated;
grant execute on function public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean) to authenticated;
grant execute on function public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean) to authenticated;
grant execute on function public.knowledge_section_search_text_v1(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.knowledge_section_content_valid_v1(text,jsonb) to service_role;
grant execute on function public.knowledge_section_metadata_valid_v1(jsonb) to service_role;
grant execute on function public.knowledge_touch_updated_at_v1() to service_role;

do $knowledge_final_contract$
declare v_table text;
begin
  foreach v_table in array array[
    'knowledge_publications','knowledge_parts','knowledge_chapters',
    'knowledge_sections','knowledge_progress','knowledge_bookmarks'
  ] loop
    if not exists(select 1 from pg_class c where c.oid=format('public.%I',v_table)::regclass and c.relrowsecurity) then
      raise exception 'knowledge area v1 contract: RLS missing on %',v_table using errcode='P0001';
    end if;
  end loop;

  if exists(
    with expected(table_name,constraint_name) as (
      values
        ('knowledge_publications','knowledge_publications_pkey'),
        ('knowledge_publications','knowledge_publications_slug_key'),
        ('knowledge_publications','knowledge_publications_product_fkey'),
        ('knowledge_parts','knowledge_parts_pkey'),
        ('knowledge_parts','knowledge_parts_publication_position_key'),
        ('knowledge_parts','knowledge_parts_id_publication_key'),
        ('knowledge_chapters','knowledge_chapters_pkey'),
        ('knowledge_chapters','knowledge_chapters_part_publication_fkey'),
        ('knowledge_chapters','knowledge_chapters_access_check'),
        ('knowledge_chapters','knowledge_chapters_publication_slug_key'),
        ('knowledge_chapters','knowledge_chapters_id_publication_key'),
        ('knowledge_sections','knowledge_sections_pkey'),
        ('knowledge_sections','knowledge_sections_access_check'),
        ('knowledge_sections','knowledge_sections_content_check'),
        ('knowledge_sections','knowledge_sections_metadata_check'),
        ('knowledge_sections','knowledge_sections_chapter_position_key'),
        ('knowledge_sections','knowledge_sections_id_chapter_key'),
        ('knowledge_progress','knowledge_progress_pkey'),
        ('knowledge_progress','knowledge_progress_chapter_publication_fkey'),
        ('knowledge_progress','knowledge_progress_section_chapter_fkey'),
        ('knowledge_progress','knowledge_progress_percent_check'),
        ('knowledge_progress','knowledge_progress_completed_check'),
        ('knowledge_bookmarks','knowledge_bookmarks_pkey'),
        ('knowledge_bookmarks','knowledge_bookmarks_chapter_publication_fkey'),
        ('knowledge_bookmarks','knowledge_bookmarks_section_chapter_fkey')
    )
    select 1 from expected e
    left join pg_constraint constraint_object
      on constraint_object.conname=e.constraint_name
     and constraint_object.conrelid=format('public.%I',e.table_name)::regclass
    where constraint_object.oid is null
  ) then
    raise exception 'knowledge area v1 contract: constraints missing' using errcode='P0001';
  end if;

  if lower(pg_get_constraintdef((select oid from pg_constraint where conrelid='public.knowledge_publications'::regclass and conname='knowledge_publications_product_fkey'))) not like '%foreign key (required_product_code)%references products(code)%'
     or lower(pg_get_constraintdef((select oid from pg_constraint where conrelid='public.knowledge_chapters'::regclass and conname='knowledge_chapters_access_check'))) not like '%access_level%public%sample%knowledge%'
     or lower(pg_get_constraintdef((select oid from pg_constraint where conrelid='public.knowledge_sections'::regclass and conname='knowledge_sections_content_check'))) not like '%knowledge_section_content_valid_v1(section_type, content)%'
     or lower(pg_get_constraintdef((select oid from pg_constraint where conrelid='public.knowledge_progress'::regclass and conname='knowledge_progress_section_chapter_fkey'))) not like '%foreign key (last_section_id, chapter_id)%references knowledge_sections(id, chapter_id)%on delete set null (last_section_id)%'
  then
    raise exception 'knowledge area v1 contract: constraint semantics differ' using errcode='P0001';
  end if;

  if (select count(*) from pg_policies where schemaname='public' and tablename like 'knowledge_%')<>13 then
    raise exception 'knowledge area v1 contract: policy count differs' using errcode='P0001';
  end if;

  if exists(
    with expected(tablename,policyname,command,required_roles) as (
      values
        ('knowledge_publications','knowledge_publications_catalog_read','SELECT',array['anon','authenticated']::name[]),
        ('knowledge_parts','knowledge_parts_catalog_read','SELECT',array['anon','authenticated']::name[]),
        ('knowledge_chapters','knowledge_chapters_catalog_read','SELECT',array['anon','authenticated']::name[]),
        ('knowledge_sections','knowledge_sections_sample_read','SELECT',array['anon','authenticated']::name[]),
        ('knowledge_sections','knowledge_sections_entitled_read','SELECT',array['authenticated']::name[]),
        ('knowledge_progress','knowledge_progress_own_read','SELECT',array['authenticated']::name[]),
        ('knowledge_progress','knowledge_progress_own_insert','INSERT',array['authenticated']::name[]),
        ('knowledge_progress','knowledge_progress_own_update','UPDATE',array['authenticated']::name[]),
        ('knowledge_progress','knowledge_progress_own_delete','DELETE',array['authenticated']::name[]),
        ('knowledge_bookmarks','knowledge_bookmarks_own_read','SELECT',array['authenticated']::name[]),
        ('knowledge_bookmarks','knowledge_bookmarks_own_insert','INSERT',array['authenticated']::name[]),
        ('knowledge_bookmarks','knowledge_bookmarks_own_update','UPDATE',array['authenticated']::name[]),
        ('knowledge_bookmarks','knowledge_bookmarks_own_delete','DELETE',array['authenticated']::name[])
    )
    select 1
    from expected e
    left join pg_policies p using(tablename,policyname)
    where p.policyname is null
       or p.cmd<>e.command
       or p.roles<>e.required_roles
       or (p.cmd in('SELECT','UPDATE','DELETE') and coalesce(p.qual,'') in('','true'))
       or (p.cmd in('INSERT','UPDATE') and coalesce(p.with_check,'') in('','true'))
  ) then
    raise exception 'knowledge area v1 contract: policy semantics differ' using errcode='P0001';
  end if;

  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='knowledge_sections'
      and policyname='knowledge_sections_entitled_read'
      and qual like '%has_active_access%'
  ) or exists(
    select 1 from pg_policies
    where schemaname='public' and tablename in('knowledge_progress','knowledge_bookmarks')
      and policyname like '%own_%'
      and coalesce(qual,with_check,'') not like '%auth.uid()%'
  ) then
    raise exception 'knowledge area v1 contract: entitlement/ownership policy differs' using errcode='P0001';
  end if;

  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name like 'knowledge_%'
      and grantee in('anon','authenticated')
      and privilege_type in('TRUNCATE','TRIGGER','REFERENCES')
  ) or exists(
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name in('knowledge_publications','knowledge_parts','knowledge_chapters','knowledge_sections')
      and grantee in('anon','authenticated') and privilege_type<>'SELECT'
  ) then
    raise exception 'knowledge area v1 contract: excessive client grants' using errcode='P0001';
  end if;

  if (select count(*) from pg_indexes where schemaname='public' and indexname in(
    'knowledge_parts_publication_idx','knowledge_chapters_publication_order_idx',
    'knowledge_sections_chapter_order_idx','knowledge_sections_search_idx',
    'knowledge_progress_user_publication_idx','knowledge_bookmarks_user_idx','knowledge_bookmarks_target_uidx'
  ))<>7 then
    raise exception 'knowledge area v1 contract: indexes missing' using errcode='P0001';
  end if;

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in('search_my_knowledge_v1','save_my_knowledge_progress_v1','set_my_knowledge_bookmark_v1')
      and (p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog, public'])
  ) then
    raise exception 'knowledge area v1 contract: RPC security differs' using errcode='P0001';
  end if;
end
$knowledge_final_contract$;

commit;
