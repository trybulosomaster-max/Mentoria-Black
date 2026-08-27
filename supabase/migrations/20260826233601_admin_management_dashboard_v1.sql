-- AVIORA V82 OWNER-only management dashboard.
--
-- This migration adds no client-readable table. Global aggregates and manual
-- grant activity remain behind the existing JWT -> Edge -> service_role RPC
-- boundary, with OWNER authorization repeated inside PostgreSQL.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-management-dashboard-v1', 0));

do $admin_management_dashboard_preflight$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.access_grants') is null
     or to_regclass('public.product_trials') is null
     or to_regclass('public.billing_order_grants') is null
     or to_regclass('public.billing_orders') is null
     or to_regclass('public.commercial_offers') is null
     or to_regclass('admin_private.admin_members') is null
     or to_regclass('admin_private.admin_audit_events') is null
     or to_regclass('admin_private.admin_operation_requests') is null
     or to_regprocedure('admin_private.assert_owner_v1(uuid)') is null
     or to_regprocedure('admin_private.consume_admin_rate_limit_v1(uuid,text,uuid,text,timestamp with time zone)') is null
     or to_regprocedure('public.admin_get_user_access_v1(uuid,uuid)') is null then
    raise exception 'admin management dashboard v1 requires the approved admin stack'
      using errcode = 'P0001';
  end if;
end
$admin_management_dashboard_preflight$;

-- Canonical, immutable provenance for grants created by the AVIORA
-- Administration layer. Actor roles are safe to resolve from membership
-- because role transitions are forbidden by the V1 membership trigger;
-- disabled STAFF rows deliberately remain available for historical display.
create or replace view admin_private.admin_license_grant_trace_v1
with (security_invoker = true)
as
select
  grant_row.id as grant_id,
  product.code as product_code,
  granted.request_id as grant_request_id,
  granted.license_kind,
  granted.actor_user_id as granted_by_user_id,
  coalesce(
    nullif(trim(grant_actor.raw_user_meta_data->>'name'), ''),
    nullif(trim(grant_actor.raw_user_meta_data->>'full_name'), '')
  ) as granted_by_name,
  grant_actor.email as granted_by_email,
  grant_member.role as granted_by_role,
  grant_member.status as granted_by_status,
  granted.created_at as granted_at,
  granted.reason as granted_reason,
  revoked.actor_user_id as revoked_by_user_id,
  coalesce(
    nullif(trim(revoke_actor.raw_user_meta_data->>'name'), ''),
    nullif(trim(revoke_actor.raw_user_meta_data->>'full_name'), '')
  ) as revoked_by_name,
  revoke_actor.email as revoked_by_email,
  revoke_member.role as revoked_by_role,
  revoke_member.status as revoked_by_status,
  revoked.created_at as revoked_at,
  revoked.reason as revoked_reason
from public.access_grants grant_row
join public.products product on product.id = grant_row.product_id
join lateral (
  select event.*
  from admin_private.admin_audit_events event
  join admin_private.admin_operation_requests operation
    on operation.request_id = event.request_id
   and operation.actor_kind = 'user'
   and operation.actor_user_id = event.actor_user_id
   and operation.action = 'licenses.grant'
   and operation.status = 'succeeded'
  where event.grant_id = grant_row.id
    and event.action = 'licenses.grant'
    and event.result = 'succeeded'
    and event.actor_kind = 'user'
    and event.actor_user_id = grant_row.granted_by
    and event.target_user_id = grant_row.user_id
    and event.product_code = product.code
    and event.license_kind in ('monthly', 'annual', 'lifetime')
    and grant_row.external_reference =
      'aviora-admin:v1:' || event.request_id::text || ':' || product.code
  order by event.created_at, event.id
  limit 1
) granted on true
left join lateral (
  select event.*
  from admin_private.admin_audit_events event
  join admin_private.admin_operation_requests operation
    on operation.request_id = event.request_id
   and operation.actor_kind = 'user'
   and operation.actor_user_id = event.actor_user_id
   and operation.action = 'licenses.revoke'
   and operation.status = 'succeeded'
  where event.grant_id = grant_row.id
    and event.action = 'licenses.revoke'
    and event.result = 'succeeded'
    and event.actor_kind = 'user'
    and event.actor_user_id = grant_row.revoked_by
    and event.target_user_id = grant_row.user_id
    and event.product_code = product.code
    and event.license_kind = granted.license_kind
  order by event.created_at desc, event.id desc
  limit 1
) revoked on true
left join auth.users grant_actor on grant_actor.id = granted.actor_user_id
left join admin_private.admin_members grant_member
  on grant_member.user_id = granted.actor_user_id
left join auth.users revoke_actor on revoke_actor.id = revoked.actor_user_id
left join admin_private.admin_members revoke_member
  on revoke_member.user_id = revoked.actor_user_id
where grant_row.source = 'manual'
  and grant_row.access_type in ('manual', 'lifetime')
  and grant_row.granted_by is not null;

revoke all on admin_private.admin_license_grant_trace_v1
  from public, anon, authenticated, service_role;

-- Extend the existing per-user license view with traceability without changing
-- its authorization contract. No actor is labeled "Sistema" when a real UUID
-- exists; the UI receives name/email separately and applies the documented
-- name -> email -> UUID fallback.
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
        'id', user_row.id,
        'name', coalesce(
          nullif(trim(user_row.raw_user_meta_data->>'name'), ''),
          nullif(trim(user_row.raw_user_meta_data->>'full_name'), '')
        ),
        'email', user_row.email,
        'created_at', user_row.created_at,
        'last_sign_in_at', user_row.last_sign_in_at
      ),
      'admin', case when member.user_id is null then null else jsonb_build_object(
        'role', member.role,
        'status', member.status,
        'internal_access', member.status = 'active'
      ) end,
      'trials', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_code', product.code,
          'state', trial.state,
          'started_at', trial.started_at,
          'expires_at', trial.expires_at,
          'converted_at', trial.converted_at,
          'revoked_at', trial.revoked_at
        ) order by product.code)
        from public.product_trials trial
        join public.products product on product.id = trial.product_id
        where trial.user_id = user_row.id
      ), '[]'::jsonb),
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grant_id', grant_row.id,
          'product_code', product.code,
          'access_type', grant_row.access_type,
          'license_kind', trace.license_kind,
          'source', grant_row.source,
          'status', grant_row.status,
          'started_at', grant_row.started_at,
          'expires_at', grant_row.expires_at,
          'grace_until', grant_row.grace_until,
          'administrative', trace.grant_id is not null,
          'external_reference', case when trace.grant_id is not null then grant_row.external_reference else null end,
          'granted', case when trace.grant_id is null then null else jsonb_build_object(
            'actor_user_id', trace.granted_by_user_id,
            'actor_name', trace.granted_by_name,
            'actor_email', trace.granted_by_email,
            'actor_role', trace.granted_by_role,
            'actor_status', trace.granted_by_status,
            'at', trace.granted_at,
            'reason', trace.granted_reason
          ) end,
          'revoked', case when trace.revoked_at is null then null else jsonb_build_object(
            'actor_user_id', trace.revoked_by_user_id,
            'actor_name', trace.revoked_by_name,
            'actor_email', trace.revoked_by_email,
            'actor_role', trace.revoked_by_role,
            'actor_status', trace.revoked_by_status,
            'at', trace.revoked_at,
            'reason', trace.revoked_reason
          ) end
        ) order by grant_row.created_at desc, grant_row.id desc)
        from public.access_grants grant_row
        join public.products product on product.id = grant_row.product_id
        left join admin_private.admin_license_grant_trace_v1 trace
          on trace.grant_id = grant_row.id
        where grant_row.user_id = user_row.id
      ), '[]'::jsonb)
    )
    from auth.users user_row
    left join admin_private.admin_members member on member.user_id = user_row.id
    where user_row.id = p_target_user_id
  );
end
$$;

-- One OWNER-only aggregate read. Counts are intentionally computed in
-- independent CTEs/subqueries so APP + KNOWLEDGE never multiplies a user.
create or replace function public.admin_get_management_dashboard_v1(
  p_actor_user_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_period_end timestamptz := coalesce(p_period_end, statement_timestamp());
  v_period_start timestamptz := coalesce(p_period_start, v_period_end - interval '30 days');
begin
  perform admin_private.assert_owner_v1(p_actor_user_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'management dashboard limit must be between 1 and 100'
      using errcode = '22023';
  end if;
  if v_period_start >= v_period_end
     or v_period_end > v_now + interval '1 minute'
     or v_period_start < v_period_end - interval '366 days' then
    raise exception 'management dashboard period is invalid'
      using errcode = '22023';
  end if;

  return (
    with valid_grants as materialized (
      select grant_row.*,
        product.code as product_code,
        trace.license_kind as admin_license_kind,
        trace.grant_id is not null as is_admin_manual,
        billing_grant.grant_id is not null as is_billing_linked,
        offer.billing_interval,
        (
          trace.grant_id is null
          and grant_row.access_type <> 'trial'
          and (
            billing_grant.grant_id is not null
            or (grant_row.source = 'kiwify' and grant_row.environment in ('legacy', 'production'))
          )
        ) as is_commercial,
        case
          when trace.grant_id is not null then trace.license_kind
          when grant_row.access_type = 'lifetime'
               and (
                 billing_grant.grant_id is not null
                 or (grant_row.source = 'kiwify' and grant_row.environment in ('legacy', 'production'))
               ) then 'lifetime'
          when billing_grant.grant_id is not null and offer.billing_interval = 'month' then 'monthly'
          when billing_grant.grant_id is not null and offer.billing_interval = 'year' then 'annual'
          else null
        end as canonical_license_kind
      from public.access_grants grant_row
      join public.products product
        on product.id = grant_row.product_id
       and product.product_kind = 'entitlement'
       and product.active
      left join admin_private.admin_license_grant_trace_v1 trace
        on trace.grant_id = grant_row.id
      left join public.billing_order_grants billing_grant
        on billing_grant.grant_id = grant_row.id
      left join public.billing_orders billing_order
        on billing_order.id = billing_grant.order_id
      left join public.commercial_offers offer
        on offer.id = billing_order.offer_id
      where grant_row.started_at <= v_now
        and (
          (grant_row.status = 'active'
            and (grant_row.expires_at is null or grant_row.expires_at > v_now))
          or (grant_row.status = 'grace_period' and grant_row.grace_until > v_now)
        )
    ), active_trials as materialized (
      select distinct trial.user_id, trial.product_id
      from public.product_trials trial
      where trial.state = 'active'
        and trial.started_at <= v_now
        and trial.expires_at > v_now
        and exists (
          select 1 from valid_grants grant_row
          where grant_row.user_id = trial.user_id
            and grant_row.product_id = trial.product_id
            and grant_row.access_type = 'trial'
        )
        and not exists (
          select 1 from valid_grants grant_row
          where grant_row.user_id = trial.user_id
            and grant_row.product_id = trial.product_id
            and grant_row.access_type <> 'trial'
        )
    ), period_manual as materialized (
      select trace.*, grant_row.user_id as target_user_id,
        grant_row.status as current_status,
        grant_row.expires_at,
        target.email as target_email,
        coalesce(
          nullif(trim(target.raw_user_meta_data->>'name'), ''),
          nullif(trim(target.raw_user_meta_data->>'full_name'), '')
        ) as target_name
      from admin_private.admin_license_grant_trace_v1 trace
      join public.access_grants grant_row on grant_row.id = trace.grant_id
      join auth.users target on target.id = grant_row.user_id
      where trace.granted_at >= v_period_start
        and trace.granted_at < v_period_end
    )
    select jsonb_build_object(
      'server_now', v_now,
      'period', jsonb_build_object(
        'start', v_period_start,
        'end', v_period_end,
        'end_exclusive', true
      ),
      'definitions', jsonb_build_object(
        'accounts', 'users',
        'active_clients', 'distinct_users_with_valid_persisted_entitlement',
        'duration_plans', 'active_grants_with_canonical_license_kind',
        'trial_active', 'distinct_users_with_effective_active_trial',
        'manual_commercial', 'active_grants_by_verified_provenance',
        'expiring_30_days', 'active_grants'
      ),
      'metrics', jsonb_build_object(
        'accounts', (
          select count(*) from auth.users user_row
          where nullif(trim(user_row.email), '') is not null
        ),
        'active_clients', (
          select count(distinct grant_row.user_id) from valid_grants grant_row
        ),
        'monthly_licenses', (
          select count(*) from valid_grants grant_row
          where grant_row.canonical_license_kind = 'monthly'
        ),
        'annual_licenses', (
          select count(*) from valid_grants grant_row
          where grant_row.canonical_license_kind = 'annual'
        ),
        'lifetime_licenses', (
          select count(*) from valid_grants grant_row
          where grant_row.canonical_license_kind = 'lifetime'
        ),
        'trial_active', (
          select count(distinct trial.user_id) from active_trials trial
        ),
        'manual_commercial', jsonb_build_object(
          'manual', (select count(*) from valid_grants grant_row where grant_row.is_admin_manual),
          'commercial', (select count(*) from valid_grants grant_row where grant_row.is_commercial),
          'unknown', (
            select count(*) from valid_grants grant_row
            where grant_row.access_type <> 'trial'
              and not grant_row.is_admin_manual
              and not grant_row.is_commercial
          )
        ),
        'expiring_30_days', jsonb_build_object(
          'grants', (
            select count(*) from valid_grants grant_row
            where grant_row.expires_at >= v_now
              and grant_row.expires_at <= v_now + interval '30 days'
          ),
          'users', (
            select count(distinct grant_row.user_id) from valid_grants grant_row
            where grant_row.expires_at >= v_now
              and grant_row.expires_at <= v_now + interval '30 days'
          )
        )
      ),
      'manual_by_actor', coalesce((
        select jsonb_agg(to_jsonb(summary_row) order by summary_row.grants desc, summary_row.actor_label)
        from (
          select trace.granted_by_user_id as actor_user_id,
            coalesce(trace.granted_by_name, trace.granted_by_email, trace.granted_by_user_id::text) as actor_label,
            trace.granted_by_name as actor_name,
            trace.granted_by_email as actor_email,
            trace.granted_by_role as actor_role,
            trace.granted_by_status as actor_status,
            count(*) as grants,
            count(*) filter (where trace.license_kind = 'monthly') as monthly,
            count(*) filter (where trace.license_kind = 'annual') as annual,
            count(*) filter (where trace.license_kind = 'lifetime') as lifetime,
            count(*) filter (where trace.product_code = 'APP') as app,
            count(*) filter (where trace.product_code = 'KNOWLEDGE') as knowledge
          from period_manual trace
          group by trace.granted_by_user_id, trace.granted_by_name,
            trace.granted_by_email, trace.granted_by_role, trace.granted_by_status
        ) summary_row
      ), '[]'::jsonb),
      'manual_activity', coalesce((
        select jsonb_agg(to_jsonb(activity_row) order by activity_row.granted_at desc, activity_row.grant_id desc)
        from (
          select trace.grant_id,
            trace.product_code,
            trace.license_kind,
            trace.current_status,
            trace.expires_at,
            trace.target_user_id,
            trace.target_name,
            trace.target_email,
            trace.granted_by_user_id,
            trace.granted_by_name,
            trace.granted_by_email,
            trace.granted_by_role,
            trace.granted_by_status,
            trace.granted_at,
            trace.granted_reason,
            trace.revoked_by_user_id,
            trace.revoked_by_name,
            trace.revoked_by_email,
            trace.revoked_by_role,
            trace.revoked_by_status,
            trace.revoked_at,
            trace.revoked_reason
          from period_manual trace
          order by trace.granted_at desc, trace.grant_id desc
          limit p_limit
        ) activity_row
      ), '[]'::jsonb)
    )
  );
end
$$;

-- The global dashboard shares the bounded read bucket. This is a complete
-- replacement of the latest local helper definition, with no change to the
-- existing limits or mutation/idempotency behavior.
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
    when 'licenses.get', 'staff.list', 'audit.list', 'management.dashboard' then
      v_bucket := 'reads'; v_limit := 60;
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
      v_has_receipt := true;
      v_idempotent_replay := true;
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
    where window_row.actor_user_id = p_actor_user_id
      and window_row.bucket = v_bucket
      and window_row.window_started_at = v_window_started_at;
    update admin_private.admin_rate_limit_windows window_row
    set denial_audited = true, updated_at = clock_timestamp()
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
        jsonb_build_object('bucket', v_bucket, 'limit', v_limit, 'reset_at', v_reset_at)
      );
    end if;
  elsif v_is_mutation and not v_has_receipt then
    insert into admin_private.admin_rate_limit_requests(
      request_id, actor_user_id, bucket, window_started_at, action, payload_hash
    ) values (
      p_request_id, p_actor_user_id, v_bucket, v_window_started_at, p_action, p_payload_hash
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

revoke all on function public.admin_get_user_access_v1(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.admin_get_management_dashboard_v1(uuid,timestamptz,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function admin_private.consume_admin_rate_limit_v1(uuid,text,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_get_user_access_v1(uuid,uuid) to service_role;
grant execute on function public.admin_get_management_dashboard_v1(uuid,timestamptz,timestamptz,integer)
  to service_role;

do $admin_management_dashboard_postconditions$
begin
  if has_schema_privilege('authenticated', 'admin_private', 'USAGE')
     or has_table_privilege('authenticated', 'admin_private.admin_license_grant_trace_v1', 'SELECT')
     or has_function_privilege('authenticated', 'public.admin_get_management_dashboard_v1(uuid,timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_get_management_dashboard_v1(uuid,timestamp with time zone,timestamp with time zone,integer)', 'EXECUTE') then
    raise exception 'admin management dashboard privileges are unsafe'
      using errcode = 'P0001';
  end if;
end
$admin_management_dashboard_postconditions$;

commit;
