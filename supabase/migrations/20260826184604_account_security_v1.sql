-- AVIORA V82 account security and administrative password recovery.
--
-- This incremental migration depends on admin_access_control_v1. It keeps
-- passwords, recovery tokens, reset URLs and Auth session tokens out of the
-- application schema and audit trail. The only server-side recovery state is
-- authorization, rate admission and a minimal delivery result.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:account-security-v1', 0));

do $account_security_preflight$
begin
  if to_regclass('auth.users') is null
     or to_regclass('admin_private.admin_members') is null
     or to_regclass('admin_private.admin_permission_catalog') is null
     or to_regclass('admin_private.admin_member_permissions') is null
     or to_regclass('admin_private.admin_audit_events') is null
     or to_regclass('admin_private.admin_operation_requests') is null
     or to_regclass('admin_private.admin_rate_limit_windows') is null
     or to_regclass('admin_private.admin_rate_limit_requests') is null
     or to_regprocedure('admin_private.assert_actor_permission_v1(uuid,text)') is null
     or to_regprocedure('admin_private.begin_operation_v1(uuid,text,uuid,text,text)') is null
     or to_regprocedure('admin_private.write_audit_v1(uuid,text,uuid,uuid,text,text,text,text,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.admin_consume_rate_limit_v1(uuid,text,uuid,text)') is null then
    raise exception 'account security v1 requires admin access control v1' using errcode = 'P0001';
  end if;
end
$account_security_preflight$;

-- The prior performance advisor warning identified this exact foreign-key
-- access path. Match the referenced column order so cascades and FK checks do
-- not scan the request ledger.
create index if not exists admin_rate_limit_requests_window_fk_idx
  on admin_private.admin_rate_limit_requests(
    actor_user_id, bucket, window_started_at
  );

-- A disabled catalog entry is deliberately not an effective OWNER permission.
-- This lets us reserve users.sessions_revoke without exposing a non-supported
-- target-user session control in V1.
alter table admin_private.admin_permission_catalog
  add column if not exists enabled boolean not null default true;

alter table admin_private.admin_permission_catalog
  drop constraint admin_permission_key_format_check;
alter table admin_private.admin_permission_catalog
  add constraint admin_permission_key_format_check
  check (permission_key ~ '^[a-z]+(?:\.[a-z]+(?:_[a-z]+)*)+$');

alter table admin_private.admin_audit_events
  drop constraint admin_audit_permission_check;
alter table admin_private.admin_audit_events
  add constraint admin_audit_permission_check
  check (
    permission_key is null
    or permission_key ~ '^[a-z]+(?:\.[a-z]+(?:_[a-z]+)*)+$'
  );

alter table admin_private.admin_permission_catalog
  add constraint admin_permission_enabled_assignment_check
  check (enabled or not staff_assignable);

insert into admin_private.admin_permission_catalog(
  permission_key, description, staff_assignable, enabled
)
values
  (
    'users.password_recovery',
    'Solicitar recuperação de senha para usuários autorizados',
    true,
    true
  ),
  (
    'users.sessions_revoke',
    'Reservado para revogação oficial de sessões de terceiros',
    false,
    false
  )
on conflict (permission_key) do update
set description = excluded.description,
    staff_assignable = excluded.staff_assignable,
    enabled = excluded.enabled;

create table admin_private.admin_password_recovery_rate_windows (
  subject_kind text not null,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  request_limit integer not null,
  denial_audited boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (subject_kind, subject_user_id, window_started_at),
  constraint admin_password_recovery_rate_subject_check
    check (subject_kind in ('actor', 'target')),
  constraint admin_password_recovery_rate_limit_check
    check (
      (subject_kind = 'actor' and request_limit = 5)
      or (subject_kind = 'target' and request_limit = 3)
    ),
  constraint admin_password_recovery_rate_count_check
    check (request_count between 0 and request_limit)
);

create table admin_private.admin_password_recovery_rate_requests (
  request_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  actor_window_started_at timestamptz not null,
  target_window_started_at timestamptz not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_password_recovery_rate_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_password_recovery_rate_window_match_check
    check (actor_window_started_at = target_window_started_at)
);

create table admin_private.admin_password_recovery_requests (
  request_id uuid primary key
    references admin_private.admin_operation_requests(request_id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  payload_hash text not null,
  reason text not null,
  status text not null default 'prepared',
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint admin_password_recovery_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint admin_password_recovery_reason_check
    check (length(trim(reason)) between 8 and 500),
  constraint admin_password_recovery_reason_secret_check check (
    lower(reason) !~ '(access[_ -]?token|refresh[_ -]?token|token[_ -]?hash|recovery[_ -]?token|authorization[[:space:]]*:[[:space:]]*bearer)'
    and reason !~ '[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
    and lower(reason) !~ 'https?://[^[:space:]]*[?#&](token|code|access_token|refresh_token|token_hash|recovery_token)='
  ),
  constraint admin_password_recovery_status_check
    check (status in ('prepared', 'succeeded', 'failed')),
  constraint admin_password_recovery_error_code_check
    check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint admin_password_recovery_completion_check check (
    (status = 'prepared' and completed_at is null and error_code is null)
    or (status = 'succeeded' and completed_at is not null and error_code is null)
    or (status = 'failed' and completed_at is not null and error_code is not null)
  )
);

create index admin_password_recovery_rate_windows_updated_idx
  on admin_private.admin_password_recovery_rate_windows(updated_at);
create index admin_password_recovery_rate_windows_subject_idx
  on admin_private.admin_password_recovery_rate_windows(
    subject_user_id, window_started_at
  );
create index admin_password_recovery_rate_requests_actor_idx
  on admin_private.admin_password_recovery_rate_requests(actor_user_id, created_at desc);
create index admin_password_recovery_rate_requests_target_idx
  on admin_private.admin_password_recovery_rate_requests(target_user_id, created_at desc);
create index admin_password_recovery_requests_actor_idx
  on admin_private.admin_password_recovery_requests(actor_user_id, created_at desc);
create index admin_password_recovery_requests_target_idx
  on admin_private.admin_password_recovery_requests(target_user_id, created_at desc);

alter table admin_private.admin_password_recovery_rate_windows enable row level security;
alter table admin_private.admin_password_recovery_rate_requests enable row level security;
alter table admin_private.admin_password_recovery_requests enable row level security;

revoke all on table admin_private.admin_password_recovery_rate_windows
  from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_password_recovery_rate_requests
  from public, anon, authenticated, service_role;
revoke all on table admin_private.admin_password_recovery_requests
  from public, anon, authenticated, service_role;

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
      select array_agg(mp.permission_key order by mp.permission_key)
      from admin_private.admin_member_permissions mp
      join admin_private.admin_permission_catalog c
        on c.permission_key = mp.permission_key
       and c.enabled
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
  v_enabled boolean;
begin
  if p_actor_user_id is null then
    raise exception 'authenticated administrative actor is required' using errcode = '42501';
  end if;

  select c.enabled into v_enabled
  from admin_private.admin_permission_catalog c
  where c.permission_key = p_permission_key;
  if not found then
    raise exception 'unknown administrative permission' using errcode = '22023';
  end if;
  if not v_enabled then
    raise exception 'administrative permission is not enabled' using errcode = '42501';
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
    join admin_private.admin_permission_catalog c
      on c.permission_key = mp.permission_key
     and c.enabled
    where mp.user_id = p_actor_user_id
      and mp.permission_key = p_permission_key
  ) then
    raise exception 'administrative permission denied' using errcode = '42501';
  end if;
  return v_role;
end
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
  v_email text;
begin
  v_actor_role := admin_private.assert_actor_permission_v1(
    p_actor_user_id,
    'users.password_recovery'
  );

  select nullif(trim(u.email), '') into v_email
  from auth.users u
  where u.id = p_target_user_id;
  if v_email is null then
    raise exception 'target user is unavailable' using errcode = '22023';
  end if;

  if v_actor_role = 'STAFF' then
    if p_target_user_id = p_actor_user_id then
      raise exception 'STAFF cannot request administrative recovery for self' using errcode = '42501';
    end if;
    if exists (
      select 1
      from admin_private.admin_members m
      where m.user_id = p_target_user_id
    ) then
      raise exception 'STAFF can request recovery only for CUSTOMER users' using errcode = '42501';
    end if;
  end if;

  return v_email;
end
$$;

create or replace function admin_private.validate_password_recovery_reason_v1(
  p_reason text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if length(v_reason) not between 8 and 500 then
    raise exception 'password recovery reason is required' using errcode = '22023';
  end if;
  if lower(v_reason) ~ '(access[_ -]?token|refresh[_ -]?token|token[_ -]?hash|recovery[_ -]?token|authorization[[:space:]]*:[[:space:]]*bearer)'
     or v_reason ~ '[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
     or lower(v_reason) ~ 'https?://[^[:space:]]*[?#&](token|code|access_token|refresh_token|token_hash|recovery_token)=' then
    raise exception 'password recovery reason contains forbidden secret material' using errcode = '22023';
  end if;
  return v_reason;
end
$$;

-- Password recovery is also a privileged mutation for the shared short-window
-- limiter. A stricter actor/target hourly limiter is applied atomically by the
-- prepare RPC below.
alter table admin_private.admin_rate_limit_requests
  drop constraint admin_rate_limit_request_action_check;
alter table admin_private.admin_rate_limit_requests
  add constraint admin_rate_limit_request_action_check
  check (action in (
    'licenses.grant', 'licenses.revoke', 'staff.add',
    'staff.permissions.set', 'staff.status.set',
    'users.password_recovery'
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
         'staff.permissions.set', 'staff.status.set',
         'users.password_recovery' then
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

create or replace function admin_private.consume_password_recovery_rate_limit_v1(
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
  v_receipt admin_private.admin_password_recovery_rate_requests%rowtype;
begin
  if p_actor_user_id is null
     or p_target_user_id is null
     or p_request_id is null
     or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
     or p_now is null
     or not exists (select 1 from auth.users u where u.id = p_actor_user_id)
     or not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'valid password recovery rate-limit input is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-password-recovery-rate-request:' || p_request_id::text,
    0
  ));
  select receipt.* into v_receipt
  from admin_private.admin_password_recovery_rate_requests receipt
  where receipt.request_id = p_request_id;
  if found then
    if v_receipt.actor_user_id <> p_actor_user_id
       or v_receipt.target_user_id <> p_target_user_id
       or v_receipt.payload_hash <> p_payload_hash then
      raise exception 'idempotency request conflict' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'allowed', true,
      'bucket', 'password_recovery',
      'retry_after_seconds', 0,
      'idempotent_replay', true
    );
  end if;

  v_window_started_at := date_trunc('hour', p_now);
  v_reset_at := v_window_started_at + interval '1 hour';
  v_retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_reset_at - p_now)))::integer
  );

  -- Actor and target use disjoint advisory-lock namespaces. Every call takes
  -- them in this order, so reciprocal actors/targets cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-password-recovery-rate-actor:' || p_actor_user_id::text || ':' ||
    v_window_started_at::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-password-recovery-rate-target:' || p_target_user_id::text || ':' ||
    v_window_started_at::text,
    0
  ));

  insert into admin_private.admin_password_recovery_rate_windows(
    subject_kind, subject_user_id, window_started_at,
    request_count, request_limit
  ) values
    ('actor', p_actor_user_id, v_window_started_at, 0, 5),
    ('target', p_target_user_id, v_window_started_at, 0, 3)
  on conflict (subject_kind, subject_user_id, window_started_at) do nothing;

  select window_row.request_count into v_actor_count
  from admin_private.admin_password_recovery_rate_windows window_row
  where window_row.subject_kind = 'actor'
    and window_row.subject_user_id = p_actor_user_id
    and window_row.window_started_at = v_window_started_at
  for update;

  select window_row.request_count into v_target_count
  from admin_private.admin_password_recovery_rate_windows window_row
  where window_row.subject_kind = 'target'
    and window_row.subject_user_id = p_target_user_id
    and window_row.window_started_at = v_window_started_at
  for update;

  if v_actor_count >= 5 or v_target_count >= 3 then
    if v_actor_count >= 5 then
      update admin_private.admin_password_recovery_rate_windows window_row
      set denial_audited = true,
          updated_at = clock_timestamp()
      where window_row.subject_kind = 'actor'
        and window_row.subject_user_id = p_actor_user_id
        and window_row.window_started_at = v_window_started_at
        and not window_row.denial_audited
      returning true into v_actor_denial_audited;
    end if;
    if v_target_count >= 3 then
      update admin_private.admin_password_recovery_rate_windows window_row
      set denial_audited = true,
          updated_at = clock_timestamp()
      where window_row.subject_kind = 'target'
        and window_row.subject_user_id = p_target_user_id
        and window_row.window_started_at = v_window_started_at
        and not window_row.denial_audited
      returning true into v_target_denial_audited;
    end if;

    if coalesce(v_actor_denial_audited, false)
       or coalesce(v_target_denial_audited, false) then
      perform admin_private.write_audit_v1(
        gen_random_uuid(), 'user', p_actor_user_id, p_target_user_id,
        'rate_limit.denied', null, 'users.password_recovery', null, null,
        'Password recovery rate limit exceeded', 'denied', 'rate_limited',
        jsonb_build_object(
          'bucket', 'password_recovery',
          'actor_limit', 5,
          'target_limit', 3,
          'actor_limited', v_actor_count >= 5,
          'target_limited', v_target_count >= 3,
          'reset_at', v_reset_at
        )
      );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'bucket', 'password_recovery',
      'actor_limit', 5,
      'actor_count', v_actor_count,
      'target_limit', 3,
      'target_count', v_target_count,
      'reset_at', v_reset_at,
      'retry_after_seconds', v_retry_after_seconds,
      'idempotent_replay', false
    );
  end if;

  update admin_private.admin_password_recovery_rate_windows window_row
  set request_count = request_count + 1,
      updated_at = clock_timestamp()
  where window_row.subject_kind = 'actor'
    and window_row.subject_user_id = p_actor_user_id
    and window_row.window_started_at = v_window_started_at
  returning request_count into v_actor_count;

  update admin_private.admin_password_recovery_rate_windows window_row
  set request_count = request_count + 1,
      updated_at = clock_timestamp()
  where window_row.subject_kind = 'target'
    and window_row.subject_user_id = p_target_user_id
    and window_row.window_started_at = v_window_started_at
  returning request_count into v_target_count;

  insert into admin_private.admin_password_recovery_rate_requests(
    request_id, actor_user_id, target_user_id,
    actor_window_started_at, target_window_started_at, payload_hash
  ) values (
    p_request_id, p_actor_user_id, p_target_user_id,
    v_window_started_at, v_window_started_at, p_payload_hash
  );

  delete from admin_private.admin_password_recovery_rate_windows old_window
  where old_window.window_started_at < v_window_started_at - interval '48 hours'
    and (
      (old_window.subject_kind = 'actor' and old_window.subject_user_id = p_actor_user_id)
      or (old_window.subject_kind = 'target' and old_window.subject_user_id = p_target_user_id)
    );

  return jsonb_build_object(
    'allowed', true,
    'bucket', 'password_recovery',
    'actor_limit', 5,
    'actor_count', v_actor_count,
    'actor_remaining', greatest(5 - v_actor_count, 0),
    'target_limit', 3,
    'target_count', v_target_count,
    'target_remaining', greatest(3 - v_target_count, 0),
    'reset_at', v_reset_at,
    'retry_after_seconds', 0,
    'idempotent_replay', false
  );
end
$$;

create or replace function public.admin_prepare_password_recovery_v1(
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
declare
  v_target_email text;
  v_rate jsonb;
  v_cached jsonb;
  v_reason text;
begin
  v_reason := admin_private.validate_password_recovery_reason_v1(p_reason);

  -- This authorization is intentionally repeated in PostgreSQL. The Edge/UI
  -- may hide actions, but neither is the authority for target protection.
  v_target_email := admin_private.assert_password_recovery_target_v1(
    p_actor_user_id,
    p_target_user_id
  );

  v_rate := admin_private.consume_password_recovery_rate_limit_v1(
    p_actor_user_id,
    p_target_user_id,
    p_request_id,
    p_payload_hash,
    clock_timestamp()
  );
  if not coalesce((v_rate->>'allowed')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object('code', 'rate_limited'),
      'retry_after_seconds', greatest(
        1,
        least(3600, coalesce((v_rate->>'retry_after_seconds')::integer, 3600))
      )
    );
  end if;

  v_cached := admin_private.begin_operation_v1(
    p_request_id,
    'user',
    p_actor_user_id,
    'users.password_recovery',
    p_payload_hash
  );
  if v_cached is not null then
    return v_cached || jsonb_build_object(
      'send_required', false,
      'idempotent', true
    );
  end if;

  insert into admin_private.admin_password_recovery_requests(
    request_id, actor_user_id, target_user_id, payload_hash, reason
  ) values (
    p_request_id, p_actor_user_id, p_target_user_id, p_payload_hash, v_reason
  );

  -- target_email is transient RPC output to the server-side Edge Function.
  -- It is deliberately absent from every persisted response and audit row.
  return jsonb_build_object(
    'ok', true,
    'send_required', true,
    'target_email', v_target_email,
    'request_id', p_request_id,
    'idempotent', false
  );
end
$$;

create or replace function public.admin_complete_password_recovery_v1(
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
  v_request admin_private.admin_password_recovery_requests%rowtype;
  v_operation admin_private.admin_operation_requests%rowtype;
  v_response jsonb;
  v_error_code text;
begin
  if p_result not in ('succeeded', 'failed') then
    raise exception 'password recovery result is invalid' using errcode = '22023';
  end if;
  v_error_code := nullif(trim(coalesce(p_error_code, '')), '');
  if (p_result = 'succeeded' and v_error_code is not null)
     or (p_result = 'failed' and coalesce(v_error_code, '') !~ '^[a-z][a-z0-9_]{2,63}$') then
    raise exception 'password recovery error code is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'aviora-admin-operation:' || p_request_id::text,
    0
  ));

  select recovery.* into v_request
  from admin_private.admin_password_recovery_requests recovery
  where recovery.request_id = p_request_id
  for update;
  if not found
     or v_request.actor_user_id <> p_actor_user_id
     or v_request.target_user_id <> p_target_user_id
     or v_request.payload_hash <> p_payload_hash then
    raise exception 'password recovery reservation is invalid' using errcode = '22023';
  end if;

  select operation.* into v_operation
  from admin_private.admin_operation_requests operation
  where operation.request_id = p_request_id
  for update;
  if not found
     or v_operation.actor_kind <> 'user'
     or v_operation.actor_user_id is distinct from p_actor_user_id
     or v_operation.action <> 'users.password_recovery'
     or v_operation.payload_hash <> p_payload_hash then
    raise exception 'password recovery operation is invalid' using errcode = '22023';
  end if;

  if v_request.status in ('succeeded', 'failed') then
    return v_operation.response || jsonb_build_object(
      'send_required', false,
      'idempotent', true
    );
  end if;
  if v_operation.status <> 'processing' then
    raise exception 'password recovery operation is unavailable for completion' using errcode = '55000';
  end if;

  if p_result = 'succeeded' then
    v_response := jsonb_build_object(
      'ok', true,
      'request_id', p_request_id,
      'target_user_id', p_target_user_id,
      'requested', true,
      'result', 'succeeded',
      'idempotent', false
    );
  else
    v_response := jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object('code', v_error_code),
      'request_id', p_request_id,
      'target_user_id', p_target_user_id,
      'requested', false,
      'result', 'failed',
      'idempotent', false
    );
  end if;

  update admin_private.admin_password_recovery_requests recovery
  set status = p_result,
      error_code = case when p_result = 'failed' then v_error_code else null end,
      completed_at = clock_timestamp()
  where recovery.request_id = p_request_id;

  perform admin_private.write_audit_v1(
    p_request_id,
    'user',
    p_actor_user_id,
    p_target_user_id,
    'user.password_recovery.requested',
    null,
    'users.password_recovery',
    null,
    null,
    v_request.reason,
    p_result,
    case when p_result = 'failed' then v_error_code else null end,
    jsonb_build_object('delivery', p_result)
  );

  update admin_private.admin_operation_requests operation
  set status = p_result,
      response = v_response,
      completed_at = clock_timestamp()
  where operation.request_id = p_request_id
    and operation.status = 'processing';
  if not found then
    raise exception 'password recovery operation is unavailable for completion' using errcode = '55000';
  end if;

  return v_response;
end
$$;

revoke all on function admin_private.effective_permissions_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_actor_permission_v1(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function admin_private.assert_password_recovery_target_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function admin_private.validate_password_recovery_reason_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function admin_private.consume_admin_rate_limit_v1(uuid,text,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function admin_private.consume_password_recovery_rate_limit_v1(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)
  to service_role;
grant execute on function public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)
  to service_role;

do $account_security_verify$
begin
  if to_regclass('admin_private.admin_password_recovery_rate_windows') is null
     or to_regclass('admin_private.admin_password_recovery_rate_requests') is null
     or to_regclass('admin_private.admin_password_recovery_requests') is null
     or not exists (
       select 1
       from admin_private.admin_permission_catalog c
       where c.permission_key = 'users.password_recovery'
         and c.enabled
         and c.staff_assignable
     )
     or not exists (
       select 1
       from admin_private.admin_permission_catalog c
       where c.permission_key = 'users.sessions_revoke'
         and not c.enabled
         and not c.staff_assignable
     )
     or not exists (
       select 1
       from pg_indexes i
       where i.schemaname = 'admin_private'
         and i.tablename = 'admin_rate_limit_requests'
         and i.indexname = 'admin_rate_limit_requests_window_fk_idx'
     ) then
    raise exception 'account security schema verification failed' using errcode = 'P0001';
  end if;

  if has_schema_privilege('authenticated', 'admin_private', 'USAGE')
     or has_schema_privilege('service_role', 'admin_private', 'USAGE')
     or has_table_privilege(
       'authenticated',
       'admin_private.admin_password_recovery_requests',
       'SELECT'
     )
     or has_function_privilege(
       'authenticated',
       'public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)',
       'EXECUTE'
     ) then
    raise exception 'account security ACL verification failed' using errcode = 'P0001';
  end if;
end
$account_security_verify$;

commit;
