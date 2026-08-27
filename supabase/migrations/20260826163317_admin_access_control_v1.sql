-- AVIORA V82 administrative access control.
--
-- This migration is intentionally self-contained and is not applied by the
-- implementation task that created it. Administrative membership lives in a
-- dedicated, non-Data-API schema. Commercial entitlements remain in public.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-access-control-v1', 0));

do $admin_preflight$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.products') is null
     or to_regclass('public.product_trials') is null
     or to_regclass('public.access_grants') is null
     or to_regprocedure('public.has_active_access(text)') is null
     or to_regprocedure('public.get_my_entitlements()') is null
     or to_regprocedure('public.start_my_app_trial()') is null then
    raise exception 'admin access control requires the commercial access v1 contract' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'admin_private')
     and (
       exists (
         select 1 from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'admin_private'
       )
       or exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'admin_private'
       )
       or exists (
         select 1 from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'admin_private'
       )
     ) then
    raise exception 'admin_private already contains objects; manual reconciliation is required' using errcode = 'P0001';
  end if;
end
$admin_preflight$;

create schema if not exists admin_private;

revoke all on schema admin_private from public, anon, authenticated, service_role;

create table admin_private.admin_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  created_via text not null,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete restrict,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete restrict,
  last_admin_access_at timestamptz,
  constraint admin_members_role_check check (role in ('OWNER', 'STAFF')),
  constraint admin_members_status_check check (status in ('active', 'disabled')),
  constraint admin_members_created_via_check check (created_via in ('bootstrap', 'owner_action')),
  constraint admin_members_created_by_check check (
    (created_via = 'bootstrap' and created_by is null)
    or (created_via = 'owner_action' and created_by is not null)
  ),
  constraint admin_members_disabled_state_check check (
    (status = 'active' and disabled_at is null and disabled_by is null)
    or (status = 'disabled' and disabled_at is not null and disabled_by is not null)
  )
);

create table admin_private.admin_permission_catalog (
  permission_key text primary key,
  description text not null,
  staff_assignable boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_permission_key_format_check
    check (permission_key ~ '^[a-z]+(?:\.[a-z]+)+$'),
  constraint admin_permission_description_check
    check (length(trim(description)) between 3 and 160)
);

create table admin_private.admin_member_permissions (
  user_id uuid not null
    references admin_private.admin_members(user_id) on delete restrict,
  permission_key text not null
    references admin_private.admin_permission_catalog(permission_key) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  granted_by uuid not null references auth.users(id) on delete restrict,
  primary key (user_id, permission_key)
);

create table admin_private.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_kind text not null default 'user',
  actor_user_id uuid references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete restrict,
  action text not null,
  product_code text,
  permission_key text,
  license_kind text,
  grant_id uuid references public.access_grants(id) on delete restrict,
  reason text not null,
  result text not null,
  error_code text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_audit_actor_kind_check
    check (actor_kind in ('user', 'service_bootstrap', 'system')),
  constraint admin_audit_actor_check check (
    (actor_kind = 'user' and actor_user_id is not null)
    or (actor_kind <> 'user' and actor_user_id is null)
  ),
  constraint admin_audit_action_check
    check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint admin_audit_product_check
    check (product_code is null or product_code in ('APP', 'KNOWLEDGE')),
  constraint admin_audit_permission_check
    check (permission_key is null or permission_key ~ '^[a-z]+(?:\.[a-z]+)+$'),
  constraint admin_audit_license_kind_check
    check (license_kind is null or license_kind in ('annual', 'lifetime')),
  constraint admin_audit_reason_check
    check (length(trim(reason)) between 3 and 500),
  constraint admin_audit_result_check
    check (result in ('succeeded', 'denied', 'failed', 'noop')),
  constraint admin_audit_details_check
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 16384)
);

create table admin_private.admin_operation_requests (
  request_id uuid primary key,
  actor_kind text not null default 'user',
  actor_user_id uuid references auth.users(id) on delete restrict,
  action text not null,
  payload_hash text not null,
  status text not null default 'processing',
  response jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint admin_operation_actor_kind_check
    check (actor_kind in ('user', 'service_bootstrap')),
  constraint admin_operation_actor_check check (
    (actor_kind = 'user' and actor_user_id is not null)
    or (actor_kind = 'service_bootstrap' and actor_user_id is null)
  ),
  constraint admin_operation_action_check
    check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  constraint admin_operation_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_operation_status_check
    check (status in ('processing', 'succeeded', 'failed')),
  constraint admin_operation_completion_check check (
    (status = 'processing' and response is null and completed_at is null)
    or (status in ('succeeded', 'failed') and response is not null and completed_at is not null)
  )
);

-- Fixed one-minute windows are persisted in PostgreSQL so limits remain
-- effective across Edge Function isolates and concurrent requests.
create table admin_private.admin_rate_limit_windows (
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  request_limit integer not null,
  denial_audited boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id, bucket, window_started_at),
  constraint admin_rate_limit_bucket_check
    check (bucket in ('me', 'users.search', 'reads', 'mutations')),
  constraint admin_rate_limit_count_check
    check (request_count between 1 and request_limit),
  constraint admin_rate_limit_limit_check
    check (request_limit in (10, 30, 60, 120))
);

-- Successful admission of a mutation request is remembered so retries can
-- validate the same actor, action and payload hash. Every valid retry still
-- consumes the current window quota; business idempotency prevents mutation
-- duplication. Denied requests are not recorded here and can be retried in a
-- later window.
create table admin_private.admin_rate_limit_requests (
  request_id uuid primary key,
  actor_user_id uuid not null,
  bucket text not null,
  window_started_at timestamptz not null,
  action text not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_rate_limit_request_window_fk
    foreign key (actor_user_id, bucket, window_started_at)
    references admin_private.admin_rate_limit_windows(
      actor_user_id, bucket, window_started_at
    ) on delete cascade,
  constraint admin_rate_limit_request_bucket_check
    check (bucket = 'mutations'),
  constraint admin_rate_limit_request_action_check
    check (action in (
      'licenses.grant', 'licenses.revoke', 'staff.add',
      'staff.permissions.set', 'staff.status.set'
    )),
  constraint admin_rate_limit_request_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index admin_members_role_status_idx
  on admin_private.admin_members(role, status);
create index admin_members_last_access_idx
  on admin_private.admin_members(last_admin_access_at desc nulls last);
create index admin_members_created_by_idx
  on admin_private.admin_members(created_by) where created_by is not null;
create index admin_members_updated_by_idx
  on admin_private.admin_members(updated_by) where updated_by is not null;
create index admin_members_disabled_by_idx
  on admin_private.admin_members(disabled_by) where disabled_by is not null;
create index admin_member_permissions_permission_idx
  on admin_private.admin_member_permissions(permission_key, user_id);
create index admin_member_permissions_granted_by_idx
  on admin_private.admin_member_permissions(granted_by);
create index admin_audit_created_idx
  on admin_private.admin_audit_events(created_at desc, id desc);
create index admin_audit_request_idx
  on admin_private.admin_audit_events(request_id, created_at desc);
create index admin_audit_actor_idx
  on admin_private.admin_audit_events(actor_user_id, created_at desc);
create index admin_audit_target_idx
  on admin_private.admin_audit_events(target_user_id, created_at desc);
create index admin_audit_action_idx
  on admin_private.admin_audit_events(action, created_at desc);
create index admin_audit_grant_idx
  on admin_private.admin_audit_events(grant_id) where grant_id is not null;
create index admin_operations_actor_idx
  on admin_private.admin_operation_requests(actor_user_id, created_at desc);
create index admin_rate_limit_windows_expiry_idx
  on admin_private.admin_rate_limit_windows(window_started_at);
create index admin_rate_limit_requests_actor_idx
  on admin_private.admin_rate_limit_requests(actor_user_id, created_at desc);

alter table admin_private.admin_members enable row level security;
alter table admin_private.admin_permission_catalog enable row level security;
alter table admin_private.admin_member_permissions enable row level security;
alter table admin_private.admin_audit_events enable row level security;
alter table admin_private.admin_operation_requests enable row level security;
alter table admin_private.admin_rate_limit_windows enable row level security;
alter table admin_private.admin_rate_limit_requests enable row level security;

revoke all on table admin_private.admin_members from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_permission_catalog from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_member_permissions from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_audit_events from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_operation_requests from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_rate_limit_windows from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_rate_limit_requests from public, anon, authenticated, service_role;

insert into admin_private.admin_permission_catalog(permission_key, description, staff_assignable)
values
  ('users.read', 'Consultar usuários', true),
  ('licenses.read', 'Consultar licenças', true),
  ('licenses.grant', 'Conceder licenças a clientes', true),
  ('licenses.revoke', 'Revogar licenças administrativas de clientes', true),
  ('audit.read', 'Consultar auditoria administrativa', true),
  ('staff.read', 'Consultar funcionários', false),
  ('staff.manage', 'Gerenciar funcionários', false)
on conflict (permission_key) do update
set description = excluded.description,
    staff_assignable = excluded.staff_assignable;

create or replace function admin_private.protect_admin_member_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'admin members cannot be deleted in v1' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.role = 'OWNER'
     and coalesce(current_setting('aviora.owner_bootstrap_authorized', true), '') <> 'on' then
    raise exception 'OWNER can only be created by the bootstrap function' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id
       or new.created_at <> old.created_at
       or new.created_via <> old.created_via
       or new.created_by is distinct from old.created_by then
      raise exception 'immutable admin membership fields cannot change' using errcode = '42501';
    end if;
    if new.role <> old.role then
      raise exception 'admin role transitions are not supported in v1' using errcode = '42501';
    end if;
    if old.role = 'OWNER' and new.status <> old.status then
      raise exception 'OWNER status cannot be changed in v1' using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

create or replace function admin_private.protect_admin_permission_assignment_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from admin_private.admin_members m
    join admin_private.admin_permission_catalog c on c.permission_key = new.permission_key
    where m.user_id = new.user_id
      and m.role = 'STAFF'
      and c.staff_assignable
  ) then
    raise exception 'permission cannot be assigned to STAFF in v1' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger protect_admin_permission_assignment_v1
before insert or update on admin_private.admin_member_permissions
for each row execute function admin_private.protect_admin_permission_assignment_v1();

create trigger protect_admin_member_v1
before insert or update or delete on admin_private.admin_members
for each row execute function admin_private.protect_admin_member_v1();

create or replace function admin_private.effective_permissions_v1(p_user_id uuid)
returns text[]
language sql
stable
set search_path = pg_catalog
as $$
  select case
    when m.status <> 'active' then array[]::text[]
    when m.role = 'OWNER' then coalesce((
      select array_agg(c.permission_key order by c.permission_key)
      from admin_private.admin_permission_catalog c
    ), array[]::text[])
    else coalesce((
      select array_agg(mp.permission_key order by mp.permission_key)
      from admin_private.admin_member_permissions mp
      where mp.user_id = m.user_id
    ), array[]::text[])
  end
  from admin_private.admin_members m
  where m.user_id = p_user_id
$$;

create or replace function admin_private.assert_actor_permission_v1(
  p_actor_user_id uuid,
  p_permission_key text
)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_role text;
  v_status text;
begin
  if p_actor_user_id is null then
    raise exception 'authenticated administrative actor is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from admin_private.admin_permission_catalog c
    where c.permission_key = p_permission_key
  ) then
    raise exception 'unknown administrative permission' using errcode = '22023';
  end if;

  select m.role, m.status into v_role, v_status
  from admin_private.admin_members m
  where m.user_id = p_actor_user_id;

  if v_role is null or v_status <> 'active' then
    raise exception 'administrative access denied' using errcode = '42501';
  end if;
  if v_role = 'OWNER' then
    return v_role;
  end if;
  if not exists (
    select 1
    from admin_private.admin_member_permissions mp
    where mp.user_id = p_actor_user_id
      and mp.permission_key = p_permission_key
  ) then
    raise exception 'administrative permission denied' using errcode = '42501';
  end if;
  return v_role;
end
$$;

create or replace function admin_private.assert_active_actor_v1(p_actor_user_id uuid)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare v_role text;
begin
  select m.role into v_role
  from admin_private.admin_members m
  where m.user_id = p_actor_user_id and m.status = 'active';
  if v_role is null then
    raise exception 'administrative access denied' using errcode = '42501';
  end if;
  return v_role;
end
$$;

create or replace function admin_private.assert_owner_v1(p_actor_user_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from admin_private.admin_members m
    where m.user_id = p_actor_user_id
      and m.role = 'OWNER'
      and m.status = 'active'
  ) then
    raise exception 'OWNER access required' using errcode = '42501';
  end if;
end
$$;

create or replace function admin_private.assert_staff_customer_target_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_actor_role text
)
returns void
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'target user not found' using errcode = '22023';
  end if;
  if p_actor_role = 'STAFF' then
    if p_target_user_id = p_actor_user_id then
      raise exception 'STAFF cannot manage their own license' using errcode = '42501';
    end if;
    if exists (
      select 1 from admin_private.admin_members m
      where m.user_id = p_target_user_id
    ) then
      raise exception 'STAFF can only manage CUSTOMER licenses' using errcode = '42501';
    end if;
  end if;
end
$$;

create or replace function admin_private.validate_staff_permissions_v1(p_permission_keys text[])
returns text[]
language plpgsql
stable
set search_path = pg_catalog
as $$
declare v_permissions text[];
begin
  select coalesce(array_agg(distinct trim(permission_key) order by trim(permission_key)), array[]::text[])
    into v_permissions
  from unnest(coalesce(p_permission_keys, array[]::text[])) permission_key
  where trim(permission_key) <> '';

  if exists (
    select 1 from unnest(v_permissions) requested(permission_key)
    left join admin_private.admin_permission_catalog catalog
      on catalog.permission_key = requested.permission_key
    where catalog.permission_key is null or not catalog.staff_assignable
  ) then
    raise exception 'one or more STAFF permissions are invalid or not assignable' using errcode = '22023';
  end if;
  return v_permissions;
end
$$;

create or replace function admin_private.begin_operation_v1(
  p_request_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_action text,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare v_operation admin_private.admin_operation_requests%rowtype;
begin
  if p_request_id is null
     or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_action, '') !~ '^[a-z][a-z0-9_.]{2,79}$'
     or coalesce(p_actor_kind, '') not in ('user', 'service_bootstrap') then
    raise exception 'valid request id, action, and payload hash are required' using errcode = '22023';
  end if;
  if (p_actor_kind = 'user' and p_actor_user_id is null)
     or (p_actor_kind = 'service_bootstrap' and p_actor_user_id is not null) then
    raise exception 'operation actor is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-operation:' || p_request_id::text, 0));
  select operation.* into v_operation
  from admin_private.admin_operation_requests operation
  where operation.request_id = p_request_id
  for update;

  if found then
    if v_operation.actor_kind <> p_actor_kind
       or v_operation.actor_user_id is distinct from p_actor_user_id
       or v_operation.action <> p_action
       or v_operation.payload_hash <> p_payload_hash then
      raise exception 'idempotency request conflict' using errcode = '22023';
    end if;
    if v_operation.status in ('succeeded', 'failed') then
      return v_operation.response || jsonb_build_object('idempotent', true);
    end if;
    raise exception 'idempotent operation is still processing' using errcode = '55000';
  end if;

  insert into admin_private.admin_operation_requests(
    request_id, actor_kind, actor_user_id, action, payload_hash
  ) values (
    p_request_id, p_actor_kind, p_actor_user_id, p_action, p_payload_hash
  );
  return null;
end
$$;

create or replace function admin_private.complete_operation_v1(
  p_request_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_response) <> 'object' then
    raise exception 'operation response must be an object' using errcode = '22023';
  end if;
  update admin_private.admin_operation_requests
  set status = 'succeeded',
      response = p_response,
      completed_at = clock_timestamp()
  where request_id = p_request_id and status = 'processing';
  if not found then
    raise exception 'operation request is unavailable for completion' using errcode = '55000';
  end if;
  return p_response;
end
$$;

create or replace function admin_private.write_audit_v1(
  p_request_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_product_code text,
  p_permission_key text,
  p_license_kind text,
  p_grant_id uuid,
  p_reason text,
  p_result text,
  p_error_code text default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare v_id uuid;
begin
  insert into admin_private.admin_audit_events(
    request_id, actor_kind, actor_user_id, target_user_id, action,
    product_code, permission_key, license_kind, grant_id, reason,
    result, error_code, details
  ) values (
    p_request_id, p_actor_kind, p_actor_user_id, p_target_user_id, p_action,
    p_product_code, p_permission_key, p_license_kind, p_grant_id, trim(p_reason),
    p_result, p_error_code, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function admin_private.is_admin_grant_v1(p_grant_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.access_grants g
    join public.products p on p.id = g.product_id
    join admin_private.admin_audit_events audit
      on audit.grant_id = g.id
     and audit.action = 'licenses.grant'
     and audit.result = 'succeeded'
     and audit.actor_kind = 'user'
     and audit.actor_user_id = g.granted_by
     and audit.target_user_id = g.user_id
     and audit.product_code = p.code
    join admin_private.admin_operation_requests operation
      on operation.request_id = audit.request_id
     and operation.actor_kind = 'user'
     and operation.actor_user_id = audit.actor_user_id
     and operation.action = 'licenses.grant'
     and operation.status = 'succeeded'
    where g.id = p_grant_id
      and g.source = 'manual'
      and g.access_type in ('manual', 'lifetime')
      and g.external_reference =
        'aviora-admin:v1:' || audit.request_id::text || ':' || p.code
      and g.granted_by is not null
  )
$$;

create or replace function admin_private.consume_admin_rate_limit_v1(
  p_actor_user_id uuid,
  p_action text,
  p_request_id uuid,
  p_payload_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  v_bucket text;
  v_limit integer;
  v_is_mutation boolean := false;
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
  v_retry_after_seconds integer;
  v_count integer;
  v_allowed boolean;
  v_idempotent_replay boolean := false;
  v_has_receipt boolean := false;
  v_should_audit_denial boolean := false;
  v_operation admin_private.admin_operation_requests%rowtype;
  v_receipt admin_private.admin_rate_limit_requests%rowtype;
begin
  if p_actor_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_actor_user_id) then
    raise exception 'valid rate limit actor is required' using errcode = '22023';
  end if;

  case p_action
    when 'me' then
      v_bucket := 'me';
      v_limit := 120;
    when 'users.search' then
      v_bucket := 'users.search';
      v_limit := 30;
    when 'licenses.get', 'staff.list', 'audit.list' then
      v_bucket := 'reads';
      v_limit := 60;
    when 'licenses.grant', 'licenses.revoke', 'staff.add',
         'staff.permissions.set', 'staff.status.set' then
      v_bucket := 'mutations';
      v_limit := 10;
      v_is_mutation := true;
    else
      raise exception 'unsupported administrative rate limit action' using errcode = '22023';
  end case;

  if p_now is null then
    raise exception 'rate limit clock is required' using errcode = '22023';
  end if;
  if v_is_mutation then
    if p_request_id is null or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' then
      raise exception 'mutation rate limit requires request id and payload hash' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended('aviora-admin-rate-request:' || p_request_id::text, 0)
    );

    select operation.* into v_operation
    from admin_private.admin_operation_requests operation
    where operation.request_id = p_request_id;
    if found then
      if v_operation.actor_kind <> 'user'
         or v_operation.actor_user_id is distinct from p_actor_user_id
         or v_operation.action <> p_action
      or v_operation.payload_hash <> p_payload_hash then
        raise exception 'idempotency request conflict' using errcode = '22023';
      end if;
      v_idempotent_replay := true;
    end if;

    select receipt.* into v_receipt
    from admin_private.admin_rate_limit_requests receipt
    where receipt.request_id = p_request_id;
    if found then
      if v_receipt.actor_user_id <> p_actor_user_id
         or v_receipt.action <> p_action
      or v_receipt.payload_hash <> p_payload_hash then
        raise exception 'idempotency request conflict' using errcode = '22023';
      end if;
      v_has_receipt := true;
      v_idempotent_replay := true;
    end if;
  elsif p_request_id is not null or p_payload_hash is not null then
    raise exception 'read rate limits do not accept idempotency fields' using errcode = '22023';
  end if;

  v_window_started_at := date_trunc('minute', p_now);
  v_reset_at := v_window_started_at + interval '1 minute';
  v_retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_reset_at - p_now)))::integer
  );

  -- The lock serializes receipt creation and makes the fixed-window decision
  -- deterministic even when multiple Edge isolates reach PostgreSQL together.
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-admin-rate-window:' || p_actor_user_id::text || ':' ||
    v_bucket || ':' || v_window_started_at::text,
    0
  ));

  v_count := null;
  insert into admin_private.admin_rate_limit_windows(
    actor_user_id, bucket, window_started_at, request_count, request_limit
  ) values (
    p_actor_user_id, v_bucket, v_window_started_at, 1, v_limit
  )
  on conflict (actor_user_id, bucket, window_started_at) do update
  set request_count = admin_rate_limit_windows.request_count + 1,
      request_limit = excluded.request_limit,
      updated_at = clock_timestamp()
  where admin_rate_limit_windows.request_count < excluded.request_limit
  returning request_count into v_count;
  v_allowed := found;

  if not v_allowed then
    select window_row.request_count into v_count
    from admin_private.admin_rate_limit_windows window_row
    where window_row.actor_user_id = p_actor_user_id
      and window_row.bucket = v_bucket
      and window_row.window_started_at = v_window_started_at;

    update admin_private.admin_rate_limit_windows window_row
    set denial_audited = true,
        updated_at = clock_timestamp()
    where window_row.actor_user_id = p_actor_user_id
      and window_row.bucket = v_bucket
      and window_row.window_started_at = v_window_started_at
      and not window_row.denial_audited
    returning true into v_should_audit_denial;

    if coalesce(v_should_audit_denial, false) then
      perform admin_private.write_audit_v1(
        gen_random_uuid(), 'user', p_actor_user_id, null,
        'rate_limit.denied', null, null, null, null,
        'Administrative rate limit exceeded', 'denied', 'rate_limited',
        jsonb_build_object(
          'bucket', v_bucket,
          'limit', v_limit,
          'reset_at', v_reset_at
        )
      );
    end if;
  elsif v_is_mutation and not v_has_receipt then
    insert into admin_private.admin_rate_limit_requests(
      request_id, actor_user_id, bucket, window_started_at, action, payload_hash
    ) values (
      p_request_id, p_actor_user_id, v_bucket, v_window_started_at,
      p_action, p_payload_hash
    );
  end if;

  -- Bound durable state per actor without a global cleanup lock. The current
  -- and immediately preceding windows remain available for diagnostics.
  delete from admin_private.admin_rate_limit_windows old_window
  where old_window.actor_user_id = p_actor_user_id
    and old_window.window_started_at < v_window_started_at - interval '2 hours';

  return jsonb_build_object(
    'allowed', v_allowed,
    'bucket', v_bucket,
    'limit', v_limit,
    'count', v_count,
    'remaining', greatest(v_limit - v_count, 0),
    'reset_at', v_reset_at,
    'retry_after_seconds', case when v_allowed then 0 else v_retry_after_seconds end,
    'idempotent_replay', v_idempotent_replay
  );
end
$$;

create or replace function public.admin_consume_rate_limit_v1(
  p_actor_user_id uuid,
  p_action text,
  p_request_id uuid default null,
  p_payload_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  return admin_private.consume_admin_rate_limit_v1(
    p_actor_user_id, p_action, p_request_id, p_payload_hash, clock_timestamp()
  );
end
$$;

create or replace function public.admin_list_staff_v1(
  p_actor_user_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform admin_private.assert_actor_permission_v1(p_actor_user_id, 'staff.read');
  if p_limit not between 1 and 100 then
    raise exception 'staff list limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_user_id is null) then
    raise exception 'both cursor fields are required together' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'staff', coalesce((
      select jsonb_agg(to_jsonb(result_row) order by result_row.created_at desc, result_row.user_id desc)
      from (
        select m.user_id,
          coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), '')) as name,
          u.email,
          m.role,
          m.status,
          coalesce((
            select array_agg(mp.permission_key order by mp.permission_key)
            from admin_private.admin_member_permissions mp
            where mp.user_id = m.user_id
          ), array[]::text[]) as permissions,
          coalesce(admin_private.effective_permissions_v1(m.user_id), array[]::text[]) as effective_permissions,
          m.last_admin_access_at,
          u.last_sign_in_at,
          m.created_at,
          m.created_by,
          m.disabled_at,
          m.disabled_by
        from admin_private.admin_members m
        join auth.users u on u.id = m.user_id
        where m.role = 'STAFF'
          and (p_cursor_created_at is null or (m.created_at, m.user_id) < (p_cursor_created_at, p_cursor_user_id))
        order by m.created_at desc, m.user_id desc
        limit p_limit
      ) result_row
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_add_staff_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_permission_keys text[],
  p_reason text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_permissions text[];
  v_permission text;
  v_cached jsonb;
  v_response jsonb;
begin
  perform admin_private.assert_owner_v1(p_actor_user_id);
  if p_target_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'target user not found' using errcode = '22023';
  end if;
  if p_target_user_id = p_actor_user_id then
    raise exception 'OWNER cannot add self as STAFF' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'staff reason is required' using errcode = '22023';
  end if;
  v_permissions := admin_private.validate_staff_permissions_v1(p_permission_keys);

  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'staff.add', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-member:' || p_target_user_id::text, 0));
  if exists (select 1 from admin_private.admin_members m where m.user_id = p_target_user_id) then
    raise exception 'user already has an administrative membership' using errcode = '22023';
  end if;
  insert into admin_private.admin_members(
    user_id, role, status, created_by, created_via, updated_by
  ) values (
    p_target_user_id, 'STAFF', 'active', p_actor_user_id, 'owner_action', p_actor_user_id
  );
  foreach v_permission in array v_permissions loop
    insert into admin_private.admin_member_permissions(user_id, permission_key, granted_by)
    values (p_target_user_id, v_permission, p_actor_user_id);
    perform admin_private.write_audit_v1(
      p_request_id, 'user', p_actor_user_id, p_target_user_id,
      'staff.permission.added', null, v_permission, null, null,
      p_reason, 'succeeded'
    );
  end loop;

  perform admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, p_target_user_id,
    'staff.add', null, 'staff.manage', null, null,
    p_reason, 'succeeded', null,
    jsonb_build_object('permissions', to_jsonb(v_permissions))
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'role', 'STAFF',
    'status', 'active',
    'permissions', to_jsonb(v_permissions),
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

create or replace function public.admin_set_staff_permissions_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_permission_keys text[],
  p_reason text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_permissions text[];
  v_old_permissions text[];
  v_permission text;
  v_cached jsonb;
  v_response jsonb;
  v_result text;
begin
  perform admin_private.assert_owner_v1(p_actor_user_id);
  if p_target_user_id = p_actor_user_id then
    raise exception 'administrators cannot change their own permissions' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'staff reason is required' using errcode = '22023';
  end if;
  v_permissions := admin_private.validate_staff_permissions_v1(p_permission_keys);

  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'staff.permissions.set', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-member:' || p_target_user_id::text, 0));
  if not exists (
    select 1 from admin_private.admin_members m
    where m.user_id = p_target_user_id and m.role = 'STAFF'
  ) then
    raise exception 'target must be STAFF' using errcode = '22023';
  end if;
  select coalesce(array_agg(mp.permission_key order by mp.permission_key), array[]::text[])
    into v_old_permissions
  from admin_private.admin_member_permissions mp
  where mp.user_id = p_target_user_id;

  delete from admin_private.admin_member_permissions mp
  where mp.user_id = p_target_user_id
    and not (mp.permission_key = any(v_permissions));
  foreach v_permission in array v_permissions loop
    insert into admin_private.admin_member_permissions(user_id, permission_key, granted_by)
    values (p_target_user_id, v_permission, p_actor_user_id)
    on conflict (user_id, permission_key) do nothing;
  end loop;
  update admin_private.admin_members
  set updated_at = clock_timestamp(), updated_by = p_actor_user_id
  where user_id = p_target_user_id;

  v_result := case when v_old_permissions = v_permissions then 'noop' else 'succeeded' end;
  for v_permission in
    select permission from unnest(v_permissions) permission
    except
    select permission from unnest(v_old_permissions) permission
  loop
    perform admin_private.write_audit_v1(
      p_request_id, 'user', p_actor_user_id, p_target_user_id,
      'staff.permission.added', null, v_permission, null, null,
      p_reason, 'succeeded'
    );
  end loop;
  for v_permission in
    select permission from unnest(v_old_permissions) permission
    except
    select permission from unnest(v_permissions) permission
  loop
    perform admin_private.write_audit_v1(
      p_request_id, 'user', p_actor_user_id, p_target_user_id,
      'staff.permission.removed', null, v_permission, null, null,
      p_reason, 'succeeded'
    );
  end loop;
  perform admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, p_target_user_id,
    'staff.permissions.set', null, 'staff.manage', null, null,
    p_reason, v_result, null,
    jsonb_build_object('before', to_jsonb(v_old_permissions), 'after', to_jsonb(v_permissions))
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'permissions', to_jsonb(v_permissions),
    'result', v_result,
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

create or replace function public.admin_set_staff_status_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_status text,
  p_reason text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_old_status text;
  v_cached jsonb;
  v_response jsonb;
  v_result text;
begin
  perform admin_private.assert_owner_v1(p_actor_user_id);
  if p_target_user_id = p_actor_user_id then
    raise exception 'administrators cannot change their own status' using errcode = '42501';
  end if;
  if coalesce(p_status, '') not in ('active', 'disabled') then
    raise exception 'STAFF status must be active or disabled' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'staff reason is required' using errcode = '22023';
  end if;

  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'staff.status.set', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-member:' || p_target_user_id::text, 0));
  select m.status into v_old_status
  from admin_private.admin_members m
  where m.user_id = p_target_user_id and m.role = 'STAFF'
  for update;
  if v_old_status is null then
    raise exception 'target must be STAFF' using errcode = '22023';
  end if;

  if v_old_status = p_status then
    v_result := 'noop';
  else
    update admin_private.admin_members
    set status = p_status,
        disabled_at = case when p_status = 'disabled' then clock_timestamp() else null end,
        disabled_by = case when p_status = 'disabled' then p_actor_user_id else null end,
        updated_at = clock_timestamp(),
        updated_by = p_actor_user_id
    where user_id = p_target_user_id;
    v_result := 'succeeded';
  end if;

  perform admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, p_target_user_id,
    case
      when v_result = 'noop' then 'staff.status.set'
      when p_status = 'active' then 'staff.activated'
      else 'staff.disabled'
    end,
    null, 'staff.manage', null, null,
    p_reason, v_result, null,
    jsonb_build_object('before', v_old_status, 'after', p_status)
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'status', p_status,
    'result', v_result,
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

create or replace function public.admin_list_audit_v1(
  p_actor_user_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_target_user_id uuid default null,
  p_action text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  perform admin_private.assert_actor_permission_v1(p_actor_user_id, 'audit.read');
  if p_limit not between 1 and 100 then
    raise exception 'audit limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'both cursor fields are required together' using errcode = '22023';
  end if;
  if p_action is not null and p_action !~ '^[a-z][a-z0-9_.]{2,79}$' then
    raise exception 'invalid audit action filter' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(to_jsonb(result_row) order by result_row.created_at desc, result_row.id desc)
      from (
        select event.id, event.request_id, event.actor_kind,
          event.actor_user_id, actor.email as actor_email,
          event.target_user_id, target.email as target_email,
          event.action, event.product_code, event.permission_key,
          event.license_kind, event.grant_id, event.reason,
          event.result, event.error_code, event.details, event.created_at
        from admin_private.admin_audit_events event
        left join auth.users actor on actor.id = event.actor_user_id
        left join auth.users target on target.id = event.target_user_id
        where (p_target_user_id is null or event.target_user_id = p_target_user_id)
          and (p_action is null or event.action = p_action)
          and (p_cursor_created_at is null or (event.created_at, event.id) < (p_cursor_created_at, p_cursor_id))
        order by event.created_at desc, event.id desc
        limit p_limit
      ) result_row
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_touch_last_access_v1(p_actor_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_role text; v_touched_at timestamptz := clock_timestamp();
begin
  v_role := admin_private.assert_active_actor_v1(p_actor_user_id);
  update admin_private.admin_members
  set last_admin_access_at = v_touched_at
  where user_id = p_actor_user_id and status = 'active';
  return jsonb_build_object('user_id', p_actor_user_id, 'role', v_role, 'last_admin_access_at', v_touched_at);
end
$$;

create or replace function public.admin_record_audit_event_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_permission_key text,
  p_product_code text,
  p_license_kind text,
  p_reason text,
  p_result text,
  p_error_code text,
  p_details jsonb,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_event_id uuid;
  v_operation admin_private.admin_operation_requests%rowtype;
  v_response jsonb;
  v_audit_target_user_id uuid;
  v_details jsonb;
begin
  if p_actor_user_id is null or not exists (select 1 from auth.users u where u.id = p_actor_user_id) then
    raise exception 'valid audit actor is required' using errcode = '22023';
  end if;
  if coalesce(p_result, '') not in ('denied', 'failed', 'noop') then
    raise exception 'security event result must be denied, failed, or noop' using errcode = '22023';
  end if;
  if p_request_id is null
     or coalesce(p_action, '') !~ '^[a-z][a-z0-9_.]{2,79}$'
     or length(trim(coalesce(p_reason, ''))) not between 3 and 500
     or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
     or (p_license_kind is not null and p_license_kind not in ('annual', 'lifetime')) then
    raise exception 'valid bounded audit event fields are required' using errcode = '22023';
  end if;

  v_details := coalesce(p_details, '{}'::jsonb);
  if p_target_user_id is not null
     and exists (select 1 from auth.users u where u.id = p_target_user_id) then
    v_audit_target_user_id := p_target_user_id;
  elsif p_target_user_id is not null then
    v_details := v_details || jsonb_build_object(
      'attempted_target_user_id', p_target_user_id::text,
      'target_user_exists', false
    );
  end if;
  if pg_column_size(v_details) > 16384 then
    raise exception 'valid bounded audit event fields are required' using errcode = '22023';
  end if;

  if p_payload_hash is not null then
    if p_payload_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'valid payload hash is required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('aviora-admin-operation:' || p_request_id::text, 0));
    select operation.* into v_operation
    from admin_private.admin_operation_requests operation
    where operation.request_id = p_request_id
    for update;

    if found then
      if v_operation.actor_kind <> 'user'
         or v_operation.actor_user_id is distinct from p_actor_user_id
         or v_operation.action <> p_action
         or v_operation.payload_hash <> p_payload_hash then
        raise exception 'idempotency request conflict' using errcode = '22023';
      end if;
      if v_operation.status in ('succeeded', 'failed') then
        return v_operation.response || jsonb_build_object('idempotent', true);
      end if;
      raise exception 'idempotent operation is still processing' using errcode = '55000';
    end if;

    v_response := jsonb_build_object(
      'ok', false,
      'request_id', p_request_id,
      'result', p_result,
      'error', jsonb_build_object('code', coalesce(p_error_code, 'administrative_operation_failed')),
      'idempotent', false
    );
    insert into admin_private.admin_operation_requests(
      request_id, actor_kind, actor_user_id, action, payload_hash,
      status, response, completed_at
    ) values (
      p_request_id, 'user', p_actor_user_id, p_action, p_payload_hash,
      'failed', v_response, clock_timestamp()
    );
  else
    v_response := jsonb_build_object(
      'ok', false,
      'request_id', p_request_id,
      'result', p_result,
      'error', jsonb_build_object('code', coalesce(p_error_code, 'administrative_request_failed')),
      'idempotent', false
    );
  end if;
  v_event_id := admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, v_audit_target_user_id,
    p_action, p_product_code, p_permission_key, p_license_kind, null,
    p_reason, p_result, p_error_code, v_details
  );
  return v_response || jsonb_build_object('event_id', v_event_id, 'recorded', true);
end
$$;

create or replace function public.get_my_admin_context_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_status text;
  v_permissions text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select m.role, m.status into v_role, v_status
  from admin_private.admin_members m
  where m.user_id = v_user_id;

  if v_role is null then
    return jsonb_build_object(
      'is_admin', false,
      'role', null,
      'status', 'customer',
      'permissions', jsonb_build_array(),
      'internal_access', jsonb_build_object('app', false, 'knowledge', false)
    );
  end if;

  if v_status = 'active' then
    v_permissions := coalesce(admin_private.effective_permissions_v1(v_user_id), array[]::text[]);
  end if;
  return jsonb_build_object(
    'is_admin', v_status = 'active',
    'role', v_role,
    'status', v_status,
    'permissions', to_jsonb(v_permissions),
    'internal_access', jsonb_build_object(
      'app', v_status = 'active',
      'knowledge', v_status = 'active'
    )
  );
end
$$;

create or replace function public.admin_bootstrap_first_owner_v1(
  p_target_user_id uuid,
  p_request_id uuid,
  p_reason text,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_cached jsonb;
  v_response jsonb;
begin
  if p_target_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_target_user_id)
     or length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'valid owner target and reason are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-first-owner', 0));
  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'service_bootstrap', null, 'owner.bootstrap', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  if exists (select 1 from admin_private.admin_members m where m.role = 'OWNER') then
    raise exception 'the first OWNER has already been bootstrapped' using errcode = '42501';
  end if;

  perform set_config('aviora.owner_bootstrap_authorized', 'on', true);
  insert into admin_private.admin_members(
    user_id, role, status, created_by, created_via, updated_by
  ) values (
    p_target_user_id, 'OWNER', 'active', null, 'bootstrap', p_target_user_id
  );

  perform admin_private.write_audit_v1(
    p_request_id, 'service_bootstrap', null, p_target_user_id,
    'owner.bootstrap', null, null, null, null, p_reason, 'succeeded'
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'role', 'OWNER',
    'status', 'active',
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

create or replace function public.admin_get_user_access_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare v_actor_role text;
begin
  v_actor_role := admin_private.assert_actor_permission_v1(p_actor_user_id, 'licenses.read');
  perform admin_private.assert_staff_customer_target_v1(
    p_actor_user_id, p_target_user_id, v_actor_role
  );
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'target user not found' using errcode = '22023';
  end if;
  return (
    select jsonb_build_object(
      'user', jsonb_build_object(
        'id', u.id,
        'name', coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), '')),
        'email', u.email,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at
      ),
      'admin', case when m.user_id is null then null else jsonb_build_object(
        'role', m.role, 'status', m.status,
        'internal_access', m.status = 'active'
      ) end,
      'trials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_code', p.code, 'state', t.state,
          'started_at', t.started_at, 'expires_at', t.expires_at,
          'converted_at', t.converted_at, 'revoked_at', t.revoked_at
        ) order by p.code)
        from public.product_trials t
        join public.products p on p.id = t.product_id
        where t.user_id = u.id
      ), '[]'::jsonb),
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grant_id', g.id, 'product_code', p.code,
          'access_type', g.access_type, 'source', g.source,
          'status', g.status, 'started_at', g.started_at,
          'expires_at', g.expires_at, 'grace_until', g.grace_until,
          'administrative', admin_private.is_admin_grant_v1(g.id),
          'external_reference', case when admin_private.is_admin_grant_v1(g.id) then g.external_reference else null end
        ) order by g.created_at desc)
        from public.access_grants g
        join public.products p on p.id = g.product_id
        where g.user_id = u.id
      ), '[]'::jsonb)
    )
    from auth.users u
    left join admin_private.admin_members m on m.user_id = u.id
    where u.id = p_target_user_id
  );
end
$$;

create or replace function public.admin_search_users_v1(
  p_actor_user_id uuid,
  p_query text,
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare v_query text; v_actor_role text;
begin
  v_actor_role := admin_private.assert_actor_permission_v1(p_actor_user_id, 'users.read');
  v_query := trim(coalesce(p_query, ''));
  if length(v_query) < 3 then
    raise exception 'user search requires at least 3 characters' using errcode = '22023';
  end if;
  if p_limit not between 1 and 50 then
    raise exception 'user search limit must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_user_id is null) then
    raise exception 'both cursor fields are required together' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(to_jsonb(result_row) order by result_row.created_at desc, result_row.user_id desc)
      from (
        select u.id as user_id,
          coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), '')) as name,
          u.email,
          u.created_at,
          u.last_sign_in_at,
          m.role as admin_role,
          m.status as admin_status,
          coalesce(m.status = 'active', false) as internal_access,
          (coalesce(m.status = 'active', false) or exists (
            select 1 from public.access_grants g
            join public.products p on p.id = g.product_id and p.code = 'APP'
            where g.user_id = u.id
              and g.started_at <= statement_timestamp()
              and (
                (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
                or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
              )
          )) as app_access,
          (coalesce(m.status = 'active', false) or exists (
            select 1 from public.access_grants g
            join public.products p on p.id = g.product_id and p.code = 'KNOWLEDGE'
            where g.user_id = u.id
              and g.started_at <= statement_timestamp()
              and (
                (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
                or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
              )
          )) as knowledge_access,
          exists (
            select 1 from public.product_trials t
            join public.products p on p.id = t.product_id and p.code = 'APP'
            where t.user_id = u.id and t.state = 'active' and t.expires_at > statement_timestamp()
          ) as trial_active
        from auth.users u
        left join admin_private.admin_members m on m.user_id = u.id
        where (
          strpos(lower(coalesce(u.email, '')), lower(v_query)) > 0
          or strpos(lower(coalesce(u.raw_user_meta_data->>'name', '')), lower(v_query)) > 0
          or strpos(lower(coalesce(u.raw_user_meta_data->>'full_name', '')), lower(v_query)) > 0
        )
          and (v_actor_role = 'OWNER' or m.user_id is null)
          and (p_cursor_created_at is null or (u.created_at, u.id) < (p_cursor_created_at, p_cursor_user_id))
        order by u.created_at desc, u.id desc
        limit p_limit
      ) result_row
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_grant_customer_license_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_product_codes text[],
  p_license_kind text,
  p_reason text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_role text;
  v_codes text[];
  v_code text;
  v_product_id uuid;
  v_grant_id uuid;
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_access_type text;
  v_reference text;
  v_grants jsonb := '[]'::jsonb;
  v_cached jsonb;
  v_response jsonb;
begin
  v_actor_role := admin_private.assert_actor_permission_v1(p_actor_user_id, 'licenses.grant');
  perform admin_private.assert_staff_customer_target_v1(p_actor_user_id, p_target_user_id, v_actor_role);
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'license reason is required' using errcode = '22023';
  end if;
  if coalesce(p_license_kind, '') not in ('annual', 'lifetime') then
    raise exception 'license kind must be annual or lifetime' using errcode = '22023';
  end if;
  select array_agg(distinct upper(trim(code)) order by upper(trim(code))) into v_codes
  from unnest(coalesce(p_product_codes, array[]::text[])) code
  where trim(code) <> '';
  if coalesce(cardinality(v_codes), 0) not between 1 and 2
     or exists (select 1 from unnest(v_codes) code where code not in ('APP', 'KNOWLEDGE')) then
    raise exception 'only APP and KNOWLEDGE may be licensed' using errcode = '22023';
  end if;

  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'licenses.grant', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-license:' || p_target_user_id::text, 0));
  v_access_type := case when p_license_kind = 'annual' then 'manual' else 'lifetime' end;
  v_expires_at := case when p_license_kind = 'annual' then v_now + interval '1 year' else null end;

  foreach v_code in array v_codes loop
    select p.id into v_product_id
    from public.products p
    where p.code = v_code and p.product_kind = 'entitlement' and p.active;
    if v_product_id is null then
      raise exception 'requested product is unavailable' using errcode = '22023';
    end if;
    v_reference := 'aviora-admin:v1:' || p_request_id::text || ':' || v_code;
    insert into public.access_grants(
      user_id, product_id, access_type, source, status,
      started_at, expires_at, external_reference,
      granted_by, administrative_reason
    ) values (
      p_target_user_id, v_product_id, v_access_type, 'manual', 'active',
      v_now, v_expires_at, v_reference,
      p_actor_user_id, trim(p_reason)
    ) returning id into v_grant_id;

    perform admin_private.write_audit_v1(
      p_request_id, 'user', p_actor_user_id, p_target_user_id,
      'licenses.grant', v_code, 'licenses.grant', p_license_kind,
      v_grant_id, p_reason, 'succeeded', null,
      jsonb_build_object('expires_at', v_expires_at)
    );
    v_grants := v_grants || jsonb_build_array(jsonb_build_object(
      'grant_id', v_grant_id,
      'product_code', v_code,
      'access_type', v_access_type,
      'expires_at', v_expires_at,
      'external_reference', v_reference
    ));
  end loop;

  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'license_kind', p_license_kind,
    'grants', v_grants,
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

create or replace function public.has_active_access(p_product_slug text default 'mentoria-black')
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with admin_context as (
    select public.get_my_admin_context_v1() as context
  )
  select exists (
    select 1
    from public.access_grants g
    join public.products p on p.id = g.product_id
    where g.user_id = (select auth.uid())
      and (p.code = upper(trim(p_product_slug)) or p.slug = lower(trim(p_product_slug)))
      and p.product_kind = 'entitlement'
      and p.active
      and g.started_at <= statement_timestamp()
      and (
        (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
        or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
      )
  ) or exists (
    select 1
    from public.products p
    cross join admin_context a
    where (p.code = upper(trim(p_product_slug)) or p.slug = lower(trim(p_product_slug)))
      and p.product_kind = 'entitlement'
      and p.active
      and p.code in ('APP', 'KNOWLEDGE')
      and coalesce((a.context->>'is_admin')::boolean, false)
  )
$$;

create or replace function public.get_my_entitlements()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with admin_context as (
    select public.get_my_admin_context_v1() as context
  ), commercial_product_state as (
    select p.code, g.access_type, g.source, g.status, g.expires_at, g.grace_until,
      coalesce(
        g.started_at <= statement_timestamp() and (
          (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
          or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
        ), false
      ) as commercial_has_access
    from public.products p
    left join lateral (
      select grant_row.*
      from public.access_grants grant_row
      where grant_row.user_id = (select auth.uid())
        and grant_row.product_id = p.id
        and grant_row.started_at <= statement_timestamp()
      order by case
        when grant_row.status = 'active' and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp()) then 1
        when grant_row.status = 'grace_period' and grant_row.grace_until > statement_timestamp() then 2
        else 3 end,
        case grant_row.access_type when 'lifetime' then 1 when 'paid' then 2 when 'manual' then 3 else 4 end,
        grant_row.created_at desc
      limit 1
    ) g on true
    where p.product_kind = 'entitlement' and p.active
  ), product_state as (
    select commercial.*,
      (commercial.code in ('APP', 'KNOWLEDGE')
        and coalesce((admin.context->>'is_admin')::boolean, false)) as internal_access,
      (commercial.commercial_has_access or (
        commercial.code in ('APP', 'KNOWLEDGE')
        and coalesce((admin.context->>'is_admin')::boolean, false)
      )) as has_access,
      case
        when commercial.commercial_has_access and coalesce((admin.context->>'is_admin')::boolean, false)
          then 'internal_and_commercial'
        when commercial.commercial_has_access then 'commercial'
        when coalesce((admin.context->>'is_admin')::boolean, false) then 'internal'
        else 'none'
      end as access_basis
    from commercial_product_state commercial
    cross join admin_context admin
  ), trial_state as (
    select case
        when t.state = 'active' and t.expires_at <= statement_timestamp() then 'expired'
        else t.state
      end as state,
      t.started_at, t.expires_at, t.converted_at, t.revoked_at
    from public.product_trials t
    join public.products p on p.id = t.product_id and p.code = 'APP'
    where t.user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'server_now', statement_timestamp(),
    'access_basis', case
      when coalesce((admin.context->>'is_admin')::boolean, false)
           and exists (select 1 from product_state state where state.commercial_has_access)
        then 'internal_and_commercial'
      when coalesce((admin.context->>'is_admin')::boolean, false) then 'internal'
      when exists (select 1 from product_state state where state.commercial_has_access) then 'commercial'
      else 'none'
    end,
    'internal_access', jsonb_build_object(
      'active', coalesce((admin.context->>'is_admin')::boolean, false),
      'role', admin.context->>'role',
      'app', coalesce((admin.context->'internal_access'->>'app')::boolean, false),
      'knowledge', coalesce((admin.context->'internal_access'->>'knowledge')::boolean, false)
    ),
    'app', coalesce((
      select jsonb_build_object(
        'has_access', state.has_access,
        'access', state.has_access,
        'access_basis', state.access_basis,
        'internal_access', state.internal_access,
        'access_type', case
          when state.commercial_has_access then state.access_type
          when state.internal_access then 'internal'
          else state.access_type end,
        'type', case
          when state.commercial_has_access then state.access_type
          when state.internal_access then 'internal'
          else state.access_type end,
        'source', case
          when state.commercial_has_access then state.source
          when state.internal_access then 'admin_role'
          else state.source end,
        'state', case
          when state.has_access then 'active'
          when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
          else coalesce(state.status, 'none') end,
        'status', case
          when state.has_access then 'active'
          when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
          else coalesce(state.status, 'none') end,
        'expires_at', state.expires_at,
        'grace_until', state.grace_until,
        'trial_remaining_seconds', case
          when state.access_type = 'trial'
          then greatest(0, extract(epoch from state.expires_at - statement_timestamp())::bigint)
          else null end,
        'commercial_state', case
          when state.status = 'grace_period' and state.grace_until > statement_timestamp() then 'payment_attention'
          when state.status in ('revoked', 'refunded', 'chargeback', 'administrative_review') then state.status
          when state.commercial_has_access then 'authorized'
          else 'expired' end,
        'commercial_access', jsonb_build_object(
          'has_access', state.commercial_has_access,
          'access_type', state.access_type,
          'source', state.source,
          'status', case
            when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
            else state.status end,
          'expires_at', state.expires_at,
          'grace_until', state.grace_until
        )
      ) from product_state state where state.code = 'APP'
    ), jsonb_build_object(
      'has_access', false, 'access', false, 'access_basis', 'none',
      'internal_access', false, 'state', 'none', 'commercial_state', 'offer',
      'commercial_access', jsonb_build_object('has_access', false)
    )),
    'knowledge', coalesce((
      select jsonb_build_object(
        'has_access', state.has_access,
        'access', state.has_access,
        'access_basis', state.access_basis,
        'internal_access', state.internal_access,
        'access_type', case
          when state.commercial_has_access then state.access_type
          when state.internal_access then 'internal'
          else state.access_type end,
        'type', case
          when state.commercial_has_access then state.access_type
          when state.internal_access then 'internal'
          else state.access_type end,
        'source', case
          when state.commercial_has_access then state.source
          when state.internal_access then 'admin_role'
          else state.source end,
        'state', case
          when state.has_access then 'active'
          when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
          else coalesce(state.status, 'none') end,
        'status', case
          when state.has_access then 'active'
          when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
          else coalesce(state.status, 'none') end,
        'expires_at', state.expires_at,
        'grace_until', state.grace_until,
        'commercial_state', case when state.commercial_has_access then 'authorized' else coalesce(state.status, 'offer') end,
        'commercial_access', jsonb_build_object(
          'has_access', state.commercial_has_access,
          'access_type', state.access_type,
          'source', state.source,
          'status', case
            when state.status = 'active' and state.expires_at <= statement_timestamp() then 'expired'
            else state.status end,
          'expires_at', state.expires_at,
          'grace_until', state.grace_until
        )
      ) from product_state state where state.code = 'KNOWLEDGE'
    ), jsonb_build_object(
      'has_access', false, 'access', false, 'access_basis', 'none',
      'internal_access', false, 'state', 'none', 'commercial_state', 'offer',
      'commercial_access', jsonb_build_object('has_access', false)
    )),
    'trial', coalesce((select to_jsonb(trial_state) from trial_state), jsonb_build_object('state', 'eligible'))
  )
  from admin_context admin
$$;

create or replace function public.start_my_app_trial()
returns table(result text, trial_state text, started_at timestamptz, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_product_id uuid;
  v_trial public.product_trials%rowtype;
  v_started_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if exists (
    select 1 from admin_private.admin_members m
    where m.user_id = v_user_id and m.status = 'active'
  ) then
    return query select 'internal_access'::text, 'eligible'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mb-app-trial:' || v_user_id::text, 0));

  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id and u.email_confirmed_at is not null
  ) then
    return query select 'not_eligible'::text, 'eligible'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  select p.id into v_product_id
  from public.products p
  where p.code = 'APP' and p.product_kind = 'entitlement' and p.active;
  if v_product_id is null then
    raise exception 'APP product unavailable' using errcode = 'P0001';
  end if;

  select t.* into v_trial
  from public.product_trials t
  where t.user_id = v_user_id and t.product_id = v_product_id
  for update;

  if found then
    if v_trial.state = 'active' and v_trial.expires_at <= clock_timestamp() then
      update public.product_trials set state = 'expired' where id = v_trial.id;
      update public.access_grants
      set status = 'expired'
      where user_id = v_user_id and product_id = v_product_id and access_type = 'trial';
      v_trial.state := 'expired';
    end if;
    return query select
      case when v_trial.state = 'active' then 'already_active' else 'already_used' end,
      v_trial.state, v_trial.started_at, v_trial.expires_at;
    return;
  end if;

  if exists (
    select 1 from public.access_grants g
    where g.user_id = v_user_id and g.product_id = v_product_id and g.access_type <> 'trial'
  ) then
    return query select 'already_used'::text, 'converted'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_started_at := current_timestamp;
  insert into public.product_trials(
    user_id, product_id, state, origin, started_at, expires_at
  ) values (
    v_user_id, v_product_id, 'active', 'confirmed_email_first_eligible_access',
    v_started_at, v_started_at + interval '168 hours'
  ) returning * into v_trial;

  insert into public.access_grants(
    user_id, product_id, access_type, source, status,
    started_at, expires_at, external_reference
  ) values (
    v_user_id, v_product_id, 'trial', 'trial', 'active',
    v_trial.started_at, v_trial.expires_at, 'trial:' || v_trial.id::text
  );

  return query select 'started'::text, v_trial.state, v_trial.started_at, v_trial.expires_at;
end
$$;

create or replace function public.admin_revoke_customer_license_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_grant_id uuid,
  p_reason text,
  p_request_id uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_role text;
  v_grant public.access_grants%rowtype;
  v_product_code text;
  v_cached jsonb;
  v_response jsonb;
  v_result text;
begin
  v_actor_role := admin_private.assert_actor_permission_v1(p_actor_user_id, 'licenses.revoke');
  perform admin_private.assert_staff_customer_target_v1(p_actor_user_id, p_target_user_id, v_actor_role);
  if length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'revocation reason is required' using errcode = '22023';
  end if;

  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'licenses.revoke', p_payload_hash
  );
  if v_cached is not null then return v_cached; end if;

  select g.* into v_grant
  from public.access_grants g
  where g.id = p_grant_id
  for update;

  if v_grant.id is null or v_grant.user_id <> p_target_user_id then
    raise exception 'grant does not belong to target user' using errcode = '22023';
  end if;
  select p.code into v_product_code
  from public.products p
  where p.id = v_grant.product_id;
  if not admin_private.is_admin_grant_v1(p_grant_id) then
    raise exception 'only AVIORA administrative grants may be revoked here' using errcode = '42501';
  end if;

  if v_grant.status = 'revoked' then
    v_result := 'noop';
  else
    update public.access_grants
    set status = 'revoked',
        revoked_at = clock_timestamp(),
        revoked_by = p_actor_user_id,
        administrative_reason = trim(p_reason),
        updated_at = clock_timestamp()
    where id = p_grant_id;
    v_result := 'succeeded';
  end if;

  perform admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, p_target_user_id,
    'licenses.revoke', v_product_code, 'licenses.revoke',
    case when v_grant.access_type = 'lifetime' then 'lifetime' else 'annual' end,
    p_grant_id, p_reason, v_result
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'grant_id', p_grant_id,
    'revoked', v_result = 'succeeded',
    'result', v_result,
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

-- Every helper is private to owner-executed functions. There are no direct
-- table grants and no client-facing policies in admin_private.
revoke all on function admin_private.protect_admin_member_v1() from public, anon, authenticated, service_role;
revoke all on function admin_private.protect_admin_permission_assignment_v1() from public, anon, authenticated, service_role;
revoke all on function admin_private.effective_permissions_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_actor_permission_v1(uuid,text) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_active_actor_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_owner_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_staff_customer_target_v1(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function admin_private.validate_staff_permissions_v1(text[]) from public, anon, authenticated, service_role;
revoke all on function admin_private.begin_operation_v1(uuid,text,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function admin_private.complete_operation_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function admin_private.write_audit_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,text,text,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function admin_private.is_admin_grant_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.consume_admin_rate_limit_v1(uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;

revoke all on function public.get_my_admin_context_v1() from public, anon, authenticated;
grant execute on function public.get_my_admin_context_v1() to authenticated, service_role;

revoke all on function public.admin_bootstrap_first_owner_v1(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.admin_get_user_access_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_search_users_v1(uuid,text,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_list_staff_v1(uuid,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.admin_add_staff_v1(uuid,uuid,text[],text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_set_staff_permissions_v1(uuid,uuid,text[],text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_set_staff_status_v1(uuid,uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_list_audit_v1(uuid,integer,timestamptz,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_touch_last_access_v1(uuid) from public, anon, authenticated;
revoke all on function public.admin_record_audit_event_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_consume_rate_limit_v1(uuid,text,uuid,text) from public, anon, authenticated;

grant execute on function public.admin_bootstrap_first_owner_v1(uuid,uuid,text,text) to service_role;
grant execute on function public.admin_get_user_access_v1(uuid,uuid) to service_role;
grant execute on function public.admin_search_users_v1(uuid,text,integer,timestamptz,uuid) to service_role;
grant execute on function public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text) to service_role;
grant execute on function public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.admin_list_staff_v1(uuid,integer,timestamptz,uuid) to service_role;
grant execute on function public.admin_add_staff_v1(uuid,uuid,text[],text,uuid,text) to service_role;
grant execute on function public.admin_set_staff_permissions_v1(uuid,uuid,text[],text,uuid,text) to service_role;
grant execute on function public.admin_set_staff_status_v1(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.admin_list_audit_v1(uuid,integer,timestamptz,uuid,uuid,text) to service_role;
grant execute on function public.admin_touch_last_access_v1(uuid) to service_role;
grant execute on function public.admin_record_audit_event_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid,text) to service_role;
grant execute on function public.admin_consume_rate_limit_v1(uuid,text,uuid,text) to service_role;

revoke all on function public.has_active_access(text) from public, anon;
revoke all on function public.get_my_entitlements() from public, anon;
revoke all on function public.start_my_app_trial() from public, anon;
grant execute on function public.has_active_access(text) to authenticated;
grant execute on function public.get_my_entitlements() to authenticated;
grant execute on function public.start_my_app_trial() to authenticated;

do $admin_verify$
begin
  if to_regclass('admin_private.admin_members') is null
     or to_regclass('admin_private.admin_permission_catalog') is null
     or to_regclass('admin_private.admin_member_permissions') is null
     or to_regclass('admin_private.admin_audit_events') is null
     or to_regclass('admin_private.admin_operation_requests') is null
     or to_regclass('admin_private.admin_rate_limit_windows') is null
     or to_regclass('admin_private.admin_rate_limit_requests') is null
     or (select count(*) from admin_private.admin_permission_catalog) <> 7 then
    raise exception 'administrative access schema verification failed' using errcode = 'P0001';
  end if;
  if has_schema_privilege('authenticated', 'admin_private', 'USAGE')
     or has_schema_privilege('service_role', 'admin_private', 'USAGE')
     or has_table_privilege('authenticated', 'admin_private.admin_members', 'SELECT')
     or has_function_privilege('authenticated', 'public.admin_consume_rate_limit_v1(uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_my_admin_context_v1()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_consume_rate_limit_v1(uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'administrative access ACL verification failed' using errcode = 'P0001';
  end if;
end
$admin_verify$;

commit;
