-- AVIORA V82 definitive administrative password-management policy.
--
-- Password material never crosses into PostgreSQL. Direct password reset is
-- performed by the server-side Edge Function with the official Auth Admin API;
-- this migration stores only authorization, non-secret idempotency metadata,
-- rate-limit state and the administrative outcome.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-password-management-v1', 0));

do $admin_password_management_preflight$
begin
  if to_regclass('auth.users') is null
     or to_regclass('admin_private.admin_members') is null
     or to_regclass('admin_private.admin_permission_catalog') is null
     or to_regclass('admin_private.admin_member_permissions') is null
     or to_regclass('admin_private.admin_audit_events') is null
     or to_regclass('admin_private.admin_operation_requests') is null
     or to_regclass('admin_private.admin_password_recovery_requests') is null
     or to_regprocedure('admin_private.begin_operation_v1(uuid,text,uuid,text,text)') is null
     or to_regprocedure('admin_private.write_audit_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)') is null
     or to_regprocedure('public.admin_consume_rate_limit_v1(uuid,text,uuid,text)') is null then
    raise exception 'admin password management v1 requires account security v1'
      using errcode = 'P0001';
  end if;
end
$admin_password_management_preflight$;

-- Recovery becomes a base capability of active STAFF against CUSTOMER only.
-- Keep the catalog row and historical assignments, but remove it from the
-- assignable permission surface. Existing audit history remains untouched.
update admin_private.admin_permission_catalog
set description = 'Capacidade base de OWNER/STAFF para recuperação de senha de alvos autorizados',
    staff_assignable = false,
    enabled = true
where permission_key = 'users.password_recovery';

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
      where c.enabled
    ), array[]::text[])
    else coalesce((
      select array_agg(permission_key order by permission_key)
      from (
        select mp.permission_key
        from admin_private.admin_member_permissions mp
        join admin_private.admin_permission_catalog c
          on c.permission_key = mp.permission_key
         and c.enabled
        where mp.user_id = m.user_id
        union
        select 'users.password_recovery'
      ) effective
    ), array[]::text[])
  end
  from admin_private.admin_members m
  where m.user_id = p_user_id
$$;

create or replace function admin_private.assert_password_recovery_target_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_actor_role text;
  v_actor_status text;
  v_target_role text;
  v_email text;
begin
  select m.role, m.status into v_actor_role, v_actor_status
  from admin_private.admin_members m
  where m.user_id = p_actor_user_id;

  if v_actor_role is null or v_actor_status <> 'active' then
    raise exception 'administrative access denied' using errcode = '42501';
  end if;
  if p_target_user_id is null or p_target_user_id = p_actor_user_id then
    raise exception 'administrative password recovery cannot target self'
      using errcode = '42501';
  end if;

  select nullif(trim(u.email), '') into v_email
  from auth.users u
  where u.id = p_target_user_id;
  if v_email is null then
    raise exception 'target user is unavailable' using errcode = '22023';
  end if;

  select m.role into v_target_role
  from admin_private.admin_members m
  where m.user_id = p_target_user_id;

  if v_target_role = 'OWNER' then
    raise exception 'OWNER password recovery is self-service only'
      using errcode = '42501';
  end if;
  if v_actor_role = 'STAFF' and v_target_role is not null then
    raise exception 'STAFF can request recovery only for CUSTOMER users'
      using errcode = '42501';
  end if;

  return v_email;
end
$$;

-- Base recovery requires a safe way for STAFF to locate CUSTOMER targets.
-- Search remains minimum-3-characters, paginated and CUSTOMER-only for STAFF.
create or replace function admin_private.assert_user_search_actor_v1(
  p_actor_user_id uuid
)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare v_role text; v_status text;
begin
  select m.role, m.status into v_role, v_status
  from admin_private.admin_members m
  where m.user_id = p_actor_user_id;
  if v_role not in ('OWNER', 'STAFF') or v_status <> 'active' then
    raise exception 'administrative user search denied' using errcode = '42501';
  end if;
  return v_role;
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
  v_actor_role := admin_private.assert_user_search_actor_v1(p_actor_user_id);
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

-- Add direct reset to the existing durable short-window mutation limiter.
alter table admin_private.admin_rate_limit_requests
  drop constraint admin_rate_limit_request_action_check;
alter table admin_private.admin_rate_limit_requests
  add constraint admin_rate_limit_request_action_check
  check (action in (
    'licenses.grant', 'licenses.revoke', 'staff.add',
    'staff.permissions.set', 'staff.status.set',
    'users.password_recovery', 'users.password.reset_direct'
  ));

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
    when 'me' then v_bucket := 'me'; v_limit := 120;
    when 'users.search' then v_bucket := 'users.search'; v_limit := 30;
    when 'licenses.get', 'staff.list', 'audit.list' then v_bucket := 'reads'; v_limit := 60;
    when 'licenses.grant', 'licenses.revoke', 'staff.add',
         'staff.permissions.set', 'staff.status.set',
         'users.password_recovery', 'users.password.reset_direct' then
      v_bucket := 'mutations'; v_limit := 10; v_is_mutation := true;
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
    perform pg_advisory_xact_lock(hashtextextended('aviora-admin-rate-request:' || p_request_id::text, 0));
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
      v_has_receipt := true; v_idempotent_replay := true;
    end if;
  elsif p_request_id is not null or p_payload_hash is not null then
    raise exception 'read rate limits do not accept idempotency fields' using errcode = '22023';
  end if;

  v_window_started_at := date_trunc('minute', p_now);
  v_reset_at := v_window_started_at + interval '1 minute';
  v_retry_after_seconds := greatest(1, ceil(extract(epoch from (v_reset_at - p_now)))::integer);
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-admin-rate-window:' || p_actor_user_id::text || ':' || v_bucket || ':' || v_window_started_at::text, 0
  ));

  v_count := null;
  insert into admin_private.admin_rate_limit_windows(
    actor_user_id, bucket, window_started_at, request_count, request_limit
  ) values (p_actor_user_id, v_bucket, v_window_started_at, 1, v_limit)
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
    where window_row.actor_user_id = p_actor_user_id and window_row.bucket = v_bucket
      and window_row.window_started_at = v_window_started_at;
    update admin_private.admin_rate_limit_windows window_row
    set denial_audited = true, updated_at = clock_timestamp()
    where window_row.actor_user_id = p_actor_user_id and window_row.bucket = v_bucket
      and window_row.window_started_at = v_window_started_at and not window_row.denial_audited
    returning true into v_should_audit_denial;
    if coalesce(v_should_audit_denial, false) then
      perform admin_private.write_audit_v1(
        gen_random_uuid(), 'user', p_actor_user_id, null, 'rate_limit.denied', null, null,
        null, null, 'Administrative rate limit exceeded', 'denied', 'rate_limited',
        jsonb_build_object('bucket', v_bucket, 'limit', v_limit, 'reset_at', v_reset_at)
      );
    end if;
  elsif v_is_mutation and not v_has_receipt then
    insert into admin_private.admin_rate_limit_requests(
      request_id, actor_user_id, bucket, window_started_at, action, payload_hash
    ) values (p_request_id, p_actor_user_id, v_bucket, v_window_started_at, p_action, p_payload_hash);
  end if;

  delete from admin_private.admin_rate_limit_windows old_window
  where old_window.actor_user_id = p_actor_user_id
    and old_window.window_started_at < v_window_started_at - interval '2 hours';

  return jsonb_build_object(
    'allowed', v_allowed, 'bucket', v_bucket, 'limit', v_limit, 'count', v_count,
    'remaining', greatest(v_limit - v_count, 0), 'reset_at', v_reset_at,
    'retry_after_seconds', case when v_allowed then 0 else v_retry_after_seconds end,
    'idempotent_replay', v_idempotent_replay
  );
end
$$;

create table admin_private.admin_direct_password_reset_rate_windows (
  subject_kind text not null,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  request_limit integer not null,
  denial_audited boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (subject_kind, subject_user_id, window_started_at),
  constraint admin_direct_password_reset_rate_subject_check check (subject_kind in ('actor', 'target')),
  constraint admin_direct_password_reset_rate_limit_check check (
    (subject_kind = 'actor' and request_limit = 3)
    or (subject_kind = 'target' and request_limit = 2)
  ),
  constraint admin_direct_password_reset_rate_count_check check (request_count between 0 and request_limit)
);

create table admin_private.admin_direct_password_reset_rate_requests (
  request_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  window_started_at timestamptz not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_direct_password_reset_rate_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

-- No password, password digest, password length, token, URL or Auth credential
-- is represented in this schema.
create table admin_private.admin_direct_password_reset_requests (
  request_id uuid primary key references admin_private.admin_operation_requests(request_id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  target_kind text not null,
  payload_hash text not null,
  reason text not null,
  status text not null default 'prepared',
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint admin_direct_password_reset_target_kind_check check (target_kind in ('CUSTOMER', 'STAFF')),
  constraint admin_direct_password_reset_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_direct_password_reset_reason_check check (length(trim(reason)) between 8 and 500),
  constraint admin_direct_password_reset_reason_secret_check check (
    lower(reason) !~ '(access[_ -]?token|refresh[_ -]?token|token[_ -]?hash|recovery[_ -]?token|authorization[[:space:]]*:[[:space:]]*bearer)'
    and reason !~ '[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
    and lower(reason) !~ 'https?://[^[:space:]]*[?#&](token|code|access_token|refresh_token|token_hash|recovery_token)='
  ),
  constraint admin_direct_password_reset_status_check check (status in ('prepared', 'succeeded', 'failed')),
  constraint admin_direct_password_reset_error_code_check check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint admin_direct_password_reset_completion_check check (
    (status = 'prepared' and completed_at is null and error_code is null)
    or (status = 'succeeded' and completed_at is not null and error_code is null)
    or (status = 'failed' and completed_at is not null and error_code is not null)
  )
);

create index admin_direct_password_reset_rate_windows_updated_idx
  on admin_private.admin_direct_password_reset_rate_windows(updated_at);
create index admin_direct_password_reset_rate_requests_actor_window_idx
  on admin_private.admin_direct_password_reset_rate_requests(actor_user_id, window_started_at);
create index admin_direct_password_reset_rate_requests_target_idx
  on admin_private.admin_direct_password_reset_rate_requests(target_user_id, created_at desc);
create index admin_direct_password_reset_requests_actor_idx
  on admin_private.admin_direct_password_reset_requests(actor_user_id, created_at desc);
create index admin_direct_password_reset_requests_target_idx
  on admin_private.admin_direct_password_reset_requests(target_user_id, created_at desc);

alter table admin_private.admin_direct_password_reset_rate_windows enable row level security;
alter table admin_private.admin_direct_password_reset_rate_requests enable row level security;
alter table admin_private.admin_direct_password_reset_requests enable row level security;
revoke all on table admin_private.admin_direct_password_reset_rate_windows from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_direct_password_reset_rate_requests from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_direct_password_reset_requests from public, anon, authenticated, service_role;

create or replace function admin_private.assert_direct_password_reset_target_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare v_actor_role text; v_actor_status text; v_target_role text;
begin
  select m.role, m.status into v_actor_role, v_actor_status
  from admin_private.admin_members m where m.user_id = p_actor_user_id;
  if v_actor_role is distinct from 'OWNER' or v_actor_status is distinct from 'active' then
    raise exception 'active OWNER access required for direct password reset'
      using errcode = '42501';
  end if;
  if p_target_user_id is null or p_target_user_id = p_actor_user_id then
    raise exception 'OWNER must manage own password through account security'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'target user not found' using errcode = '22023';
  end if;
  select m.role into v_target_role
  from admin_private.admin_members m where m.user_id = p_target_user_id;
  if v_target_role = 'OWNER' then
    raise exception 'OWNER password cannot be reset administratively'
      using errcode = '42501';
  end if;
  return case when v_target_role = 'STAFF' then 'STAFF' else 'CUSTOMER' end;
end
$$;

create or replace function admin_private.consume_direct_password_reset_rate_limit_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
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
  v_window_started_at timestamptz;
  v_reset_at timestamptz;
  v_retry_after_seconds integer;
  v_actor_count integer;
  v_target_count integer;
  v_actor_denial_audited boolean := false;
  v_target_denial_audited boolean := false;
  v_receipt admin_private.admin_direct_password_reset_rate_requests%rowtype;
  v_has_receipt boolean := false;
begin
  if p_actor_user_id is null or p_target_user_id is null or p_request_id is null
     or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' or p_now is null then
    raise exception 'valid direct password reset rate-limit input is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('aviora-direct-password-reset-rate-request:' || p_request_id::text, 0));
  select receipt.* into v_receipt
  from admin_private.admin_direct_password_reset_rate_requests receipt
  where receipt.request_id = p_request_id;
  if found then
    if v_receipt.actor_user_id <> p_actor_user_id
       or v_receipt.target_user_id <> p_target_user_id
       or v_receipt.payload_hash <> p_payload_hash then
      raise exception 'idempotency request conflict' using errcode = '22023';
    end if;
    v_has_receipt := true;
  end if;

  v_window_started_at := date_trunc('hour', p_now);
  v_reset_at := v_window_started_at + interval '1 hour';
  v_retry_after_seconds := greatest(1, ceil(extract(epoch from (v_reset_at - p_now)))::integer);
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-direct-password-reset-rate-actor:' || p_actor_user_id::text || ':' || v_window_started_at::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-direct-password-reset-rate-target:' || p_target_user_id::text || ':' || v_window_started_at::text, 0
  ));

  insert into admin_private.admin_direct_password_reset_rate_windows(
    subject_kind, subject_user_id, window_started_at, request_count, request_limit
  ) values
    ('actor', p_actor_user_id, v_window_started_at, 0, 3),
    ('target', p_target_user_id, v_window_started_at, 0, 2)
  on conflict (subject_kind, subject_user_id, window_started_at) do nothing;

  select w.request_count into v_actor_count
  from admin_private.admin_direct_password_reset_rate_windows w
  where w.subject_kind = 'actor' and w.subject_user_id = p_actor_user_id
    and w.window_started_at = v_window_started_at for update;
  select w.request_count into v_target_count
  from admin_private.admin_direct_password_reset_rate_windows w
  where w.subject_kind = 'target' and w.subject_user_id = p_target_user_id
    and w.window_started_at = v_window_started_at for update;

  if v_actor_count >= 3 or v_target_count >= 2 then
    if v_actor_count >= 3 then
      update admin_private.admin_direct_password_reset_rate_windows w
      set denial_audited = true, updated_at = clock_timestamp()
      where w.subject_kind = 'actor' and w.subject_user_id = p_actor_user_id
        and w.window_started_at = v_window_started_at and not w.denial_audited
      returning true into v_actor_denial_audited;
    end if;
    if v_target_count >= 2 then
      update admin_private.admin_direct_password_reset_rate_windows w
      set denial_audited = true, updated_at = clock_timestamp()
      where w.subject_kind = 'target' and w.subject_user_id = p_target_user_id
        and w.window_started_at = v_window_started_at and not w.denial_audited
      returning true into v_target_denial_audited;
    end if;
    if coalesce(v_actor_denial_audited, false) or coalesce(v_target_denial_audited, false) then
      perform admin_private.write_audit_v1(
        gen_random_uuid(), 'user', p_actor_user_id, p_target_user_id,
        'rate_limit.denied', null, null, null, null,
        'Direct password reset rate limit exceeded', 'denied', 'rate_limited',
        jsonb_build_object(
          'bucket', 'direct_password_reset', 'actor_limit', 3, 'target_limit', 2,
          'actor_limited', v_actor_count >= 3, 'target_limited', v_target_count >= 2,
          'reset_at', v_reset_at
        )
      );
    end if;
    return jsonb_build_object(
      'allowed', false, 'bucket', 'direct_password_reset',
      'actor_limit', 3, 'actor_count', v_actor_count,
      'target_limit', 2, 'target_count', v_target_count,
      'reset_at', v_reset_at, 'retry_after_seconds', v_retry_after_seconds,
      'idempotent_replay', v_has_receipt
    );
  end if;

  update admin_private.admin_direct_password_reset_rate_windows w
  set request_count = request_count + 1, updated_at = clock_timestamp()
  where w.subject_kind = 'actor' and w.subject_user_id = p_actor_user_id
    and w.window_started_at = v_window_started_at returning request_count into v_actor_count;
  update admin_private.admin_direct_password_reset_rate_windows w
  set request_count = request_count + 1, updated_at = clock_timestamp()
  where w.subject_kind = 'target' and w.subject_user_id = p_target_user_id
    and w.window_started_at = v_window_started_at returning request_count into v_target_count;

  if not v_has_receipt then
    insert into admin_private.admin_direct_password_reset_rate_requests(
      request_id, actor_user_id, target_user_id, window_started_at, payload_hash
    ) values (p_request_id, p_actor_user_id, p_target_user_id, v_window_started_at, p_payload_hash);
  end if;

  delete from admin_private.admin_direct_password_reset_rate_windows old_window
  where old_window.window_started_at < v_window_started_at - interval '48 hours'
    and ((old_window.subject_kind = 'actor' and old_window.subject_user_id = p_actor_user_id)
      or (old_window.subject_kind = 'target' and old_window.subject_user_id = p_target_user_id));

  return jsonb_build_object(
    'allowed', true, 'bucket', 'direct_password_reset',
    'actor_limit', 3, 'actor_count', v_actor_count, 'actor_remaining', greatest(3 - v_actor_count, 0),
    'target_limit', 2, 'target_count', v_target_count, 'target_remaining', greatest(2 - v_target_count, 0),
    'reset_at', v_reset_at, 'retry_after_seconds', 0, 'idempotent_replay', v_has_receipt
  );
end
$$;

create or replace function public.admin_prepare_direct_password_reset_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
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
declare v_target_kind text; v_rate jsonb; v_cached jsonb; v_reason text;
begin
  v_reason := admin_private.validate_password_recovery_reason_v1(p_reason);
  v_target_kind := admin_private.assert_direct_password_reset_target_v1(p_actor_user_id, p_target_user_id);
  v_rate := admin_private.consume_direct_password_reset_rate_limit_v1(
    p_actor_user_id, p_target_user_id, p_request_id, p_payload_hash, clock_timestamp()
  );
  if not coalesce((v_rate->>'allowed')::boolean, false) then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object('code', 'rate_limited'),
      'retry_after_seconds', greatest(1, least(3600, coalesce((v_rate->>'retry_after_seconds')::integer, 3600)))
    );
  end if;
  v_cached := admin_private.begin_operation_v1(
    p_request_id, 'user', p_actor_user_id, 'users.password.reset_direct', p_payload_hash
  );
  if v_cached is not null then
    return v_cached || jsonb_build_object('reset_required', false, 'idempotent', true);
  end if;
  insert into admin_private.admin_direct_password_reset_requests(
    request_id, actor_user_id, target_user_id, target_kind, payload_hash, reason
  ) values (p_request_id, p_actor_user_id, p_target_user_id, v_target_kind, p_payload_hash, v_reason);
  return jsonb_build_object(
    'ok', true, 'reset_required', true, 'request_id', p_request_id, 'idempotent', false
  );
end
$$;

create or replace function public.admin_complete_direct_password_reset_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_payload_hash text,
  p_result text,
  p_error_code text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_request admin_private.admin_direct_password_reset_requests%rowtype;
  v_operation admin_private.admin_operation_requests%rowtype;
  v_response jsonb;
  v_error_code text;
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'direct password reset result is invalid' using errcode = '22023';
  end if;
  v_error_code := nullif(trim(coalesce(p_error_code, '')), '');
  if (p_result = 'succeeded' and v_error_code is not null)
     or (p_result = 'failed' and coalesce(v_error_code, '') !~ '^[a-z][a-z0-9_]{2,63}$') then
    raise exception 'direct password reset error code is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('aviora-admin-operation:' || p_request_id::text, 0));
  select request.* into v_request
  from admin_private.admin_direct_password_reset_requests request
  where request.request_id = p_request_id for update;
  if not found or v_request.actor_user_id <> p_actor_user_id
     or v_request.target_user_id <> p_target_user_id or v_request.payload_hash <> p_payload_hash then
    raise exception 'direct password reset reservation is invalid' using errcode = '22023';
  end if;
  select operation.* into v_operation
  from admin_private.admin_operation_requests operation
  where operation.request_id = p_request_id for update;
  if not found or v_operation.actor_kind <> 'user'
     or v_operation.actor_user_id is distinct from p_actor_user_id
     or v_operation.action <> 'users.password.reset_direct'
     or v_operation.payload_hash <> p_payload_hash then
    raise exception 'direct password reset operation is invalid' using errcode = '22023';
  end if;
  if v_request.status in ('succeeded', 'failed') then
    return v_operation.response || jsonb_build_object('reset_required', false, 'idempotent', true);
  end if;
  if v_operation.status <> 'processing' then
    raise exception 'direct password reset operation is unavailable for completion' using errcode = '55000';
  end if;

  if p_result = 'succeeded' then
    v_response := jsonb_build_object(
      'ok', true, 'request_id', p_request_id, 'reset', true,
      'result', 'succeeded', 'idempotent', false
    );
  else
    v_response := jsonb_build_object(
      'ok', false, 'error', jsonb_build_object('code', v_error_code),
      'request_id', p_request_id, 'reset', false,
      'result', 'failed', 'idempotent', false
    );
  end if;

  update admin_private.admin_direct_password_reset_requests request
  set status = p_result,
      error_code = case when p_result = 'failed' then v_error_code else null end,
      completed_at = clock_timestamp()
  where request.request_id = p_request_id;

  perform admin_private.write_audit_v1(
    p_request_id, 'user', p_actor_user_id, p_target_user_id,
    'users.password.reset_direct', null, null, null, null,
    v_request.reason, p_result,
    case when p_result = 'failed' then v_error_code else null end,
    jsonb_build_object('actor_role', 'OWNER', 'target_kind', v_request.target_kind)
  );

  update admin_private.admin_operation_requests operation
  set status = p_result, response = v_response, completed_at = clock_timestamp()
  where operation.request_id = p_request_id and operation.status = 'processing';
  if not found then
    raise exception 'direct password reset operation is unavailable for completion' using errcode = '55000';
  end if;
  return v_response;
end
$$;

revoke all on function admin_private.effective_permissions_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_password_recovery_target_v1(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_user_search_actor_v1(uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.consume_admin_rate_limit_v1(uuid,text,uuid,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_direct_password_reset_target_v1(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function admin_private.consume_direct_password_reset_rate_limit_v1(uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated, service_role;

revoke all on function public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_complete_direct_password_reset_v1(uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.admin_complete_direct_password_reset_v1(uuid,uuid,uuid,text,text,text) to service_role;

do $admin_password_management_verify$
declare v_columns text;
begin
  if to_regclass('admin_private.admin_direct_password_reset_rate_windows') is null
     or to_regclass('admin_private.admin_direct_password_reset_rate_requests') is null
     or to_regclass('admin_private.admin_direct_password_reset_requests') is null then
    raise exception 'direct password reset tables were not created' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from admin_private.admin_permission_catalog c
    where c.permission_key = 'users.password_recovery' and c.enabled and not c.staff_assignable
  ) then
    raise exception 'password recovery catalog policy was not applied' using errcode = 'P0001';
  end if;
  select string_agg(lower(c.column_name), ',') into v_columns
  from information_schema.columns c
  where c.table_schema = 'admin_private'
    and c.table_name like 'admin_direct_password_reset%';
  if coalesce(v_columns, '') ~ '(password|secret|token|credential|digest)' then
    raise exception 'password-material column detected in direct reset schema' using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'direct password reset prepare RPC ACL is invalid' using errcode = 'P0001';
  end if;
end
$admin_password_management_verify$;

commit;
