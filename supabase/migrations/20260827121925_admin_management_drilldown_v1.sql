-- AVIORA V82 OWNER-only management drill-downs.
--
-- The browser never downloads the directory or the grant ledger to count or
-- filter locally. One bounded RPC returns a page of users with only the access
-- rows that match the selected management metric. The existing dashboard RPC
-- remains the source for aggregates and the 30-day manual-activity view.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-management-drilldown-v1', 0));

do $admin_management_drilldown_preflight$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.access_grants') is null
     or to_regclass('public.product_trials') is null
     or to_regclass('public.billing_order_grants') is null
     or to_regclass('public.billing_orders') is null
     or to_regclass('public.commercial_offers') is null
     or to_regclass('admin_private.admin_members') is null
     or to_regclass('admin_private.admin_license_grant_trace_v1') is null
     or to_regprocedure('admin_private.assert_owner_v1(uuid)') is null
     or to_regprocedure('public.admin_get_management_dashboard_v1(uuid,timestamp with time zone,timestamp with time zone,integer)') is null
     or to_regprocedure('public.admin_consume_rate_limit_v1(uuid,text,uuid,text)') is null then
    raise exception 'admin management drilldown v1 requires the approved management dashboard stack'
      using errcode = 'P0001';
  end if;
end
$admin_management_drilldown_preflight$;

create or replace function public.admin_list_management_drilldown_v1(
  p_actor_user_id uuid,
  p_filter text,
  p_origin text default null,
  p_limit integer default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_filter text := lower(trim(coalesce(p_filter, '')));
  v_origin text := lower(trim(coalesce(p_origin, '')));
begin
  -- Authorization intentionally precedes every validation and data read.
  perform admin_private.assert_owner_v1(p_actor_user_id);

  if v_filter not in (
    'accounts', 'active_clients', 'monthly', 'annual', 'lifetime',
    'trial_active', 'origin', 'expiring_30_days'
  ) then
    raise exception 'management drilldown filter is invalid' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'management drilldown limit must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_user_id is null) then
    raise exception 'both management cursor fields are required together' using errcode = '22023';
  end if;
  if v_filter = 'origin' and v_origin not in ('manual', 'commercial') then
    raise exception 'management origin must be manual or commercial' using errcode = '22023';
  end if;
  if v_filter <> 'origin' and v_origin <> '' then
    raise exception 'management origin is only valid for the origin filter' using errcode = '22023';
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
        end as canonical_license_kind,
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
        trace.revoked_at as canonical_revoked_at,
        trace.revoked_reason as canonical_revoked_reason
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
    ), effective_trials as materialized (
      select trial.user_id, trial.product_id, product.code as product_code,
        trial.state, trial.started_at, trial.expires_at
      from public.product_trials trial
      join public.products product
        on product.id = trial.product_id
       and product.product_kind = 'entitlement'
       and product.active
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
    ), eligible_users as materialized (
      select user_row.id as user_id,
        user_row.created_at,
        user_row.email,
        coalesce(
          nullif(trim(user_row.raw_user_meta_data->>'name'), ''),
          nullif(trim(user_row.raw_user_meta_data->>'full_name'), '')
        ) as name,
        member.role as admin_role,
        member.status as admin_status
      from auth.users user_row
      left join admin_private.admin_members member on member.user_id = user_row.id
      where nullif(trim(user_row.email), '') is not null
        and (
          v_filter = 'accounts'
          or (v_filter = 'active_clients' and exists (
            select 1 from valid_grants grant_row where grant_row.user_id = user_row.id
          ))
          or (v_filter in ('monthly', 'annual', 'lifetime') and exists (
            select 1 from valid_grants grant_row
            where grant_row.user_id = user_row.id
              and grant_row.canonical_license_kind = v_filter
          ))
          or (v_filter = 'trial_active' and exists (
            select 1 from effective_trials trial where trial.user_id = user_row.id
          ))
          or (v_filter = 'origin' and exists (
            select 1 from valid_grants grant_row
            where grant_row.user_id = user_row.id
              and (
                (v_origin = 'manual' and grant_row.is_admin_manual)
                or (v_origin = 'commercial' and grant_row.is_commercial)
              )
          ))
          or (v_filter = 'expiring_30_days' and exists (
            select 1 from valid_grants grant_row
            where grant_row.user_id = user_row.id
              and grant_row.expires_at >= v_now
              and grant_row.expires_at <= v_now + interval '30 days'
          ))
        )
        and (
          p_cursor_created_at is null
          or (user_row.created_at, user_row.id) < (p_cursor_created_at, p_cursor_user_id)
        )
      order by user_row.created_at desc, user_row.id desc
      limit p_limit + 1
    ), page_users as materialized (
      select * from eligible_users
      order by created_at desc, user_id desc
      limit p_limit
    ), result_rows as (
      select page.user_id, page.name, page.email, page.created_at,
        page.admin_role, page.admin_status,
        case when v_filter = 'trial_active' then coalesce((
          select jsonb_build_object(
            'state', 'active',
            'started_at', min(trial.started_at),
            'expires_at', max(trial.expires_at),
            'products', array_agg(trial.product_code order by trial.product_code)
          )
          from effective_trials trial
          where trial.user_id = page.user_id
        ), '{}'::jsonb) else '{}'::jsonb end as trial,
        case when v_filter = 'accounts' or v_filter = 'trial_active' then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'grant_id', grant_row.id,
            'product_code', grant_row.product_code,
            'access_type', grant_row.access_type,
            'license_kind', grant_row.canonical_license_kind,
            'source', grant_row.source,
            'status', grant_row.status,
            'started_at', grant_row.started_at,
            'expires_at', grant_row.expires_at,
            'grace_until', grant_row.grace_until,
            'administrative', grant_row.is_admin_manual,
            'origin_class', case
              when grant_row.is_admin_manual then 'manual'
              when grant_row.is_commercial then 'commercial'
              else 'unknown'
            end,
            'granted', case when not grant_row.is_admin_manual then null else jsonb_build_object(
              'actor_user_id', grant_row.granted_by_user_id,
              'actor_name', grant_row.granted_by_name,
              'actor_email', grant_row.granted_by_email,
              'actor_role', grant_row.granted_by_role,
              'actor_status', grant_row.granted_by_status,
              'at', grant_row.granted_at,
              'reason', grant_row.granted_reason
            ) end,
            'revoked', case when grant_row.canonical_revoked_at is null then null else jsonb_build_object(
              'actor_user_id', grant_row.revoked_by_user_id,
              'actor_name', grant_row.revoked_by_name,
              'actor_email', grant_row.revoked_by_email,
              'actor_role', grant_row.revoked_by_role,
              'actor_status', grant_row.revoked_by_status,
              'at', grant_row.canonical_revoked_at,
              'reason', grant_row.canonical_revoked_reason
            ) end
          ) order by grant_row.started_at desc, grant_row.id desc)
          from valid_grants grant_row
          where grant_row.user_id = page.user_id
            and (
              v_filter = 'active_clients'
              or (v_filter in ('monthly', 'annual', 'lifetime')
                and grant_row.canonical_license_kind = v_filter)
              or (v_filter = 'origin' and (
                (v_origin = 'manual' and grant_row.is_admin_manual)
                or (v_origin = 'commercial' and grant_row.is_commercial)
              ))
              or (v_filter = 'expiring_30_days'
                and grant_row.expires_at >= v_now
                and grant_row.expires_at <= v_now + interval '30 days')
            )
        ), '[]'::jsonb) end as access
      from page_users page
    )
    select jsonb_build_object(
      'filter', v_filter,
      'origin', nullif(v_origin, ''),
      'entity', case when v_filter in ('accounts', 'active_clients', 'trial_active') then 'users' else 'grants' end,
      'items', coalesce((
        select jsonb_agg(to_jsonb(result_row) order by result_row.created_at desc, result_row.user_id desc)
        from result_rows result_row
      ), '[]'::jsonb),
      'next_cursor', case when (select count(*) from eligible_users) > p_limit then (
        select jsonb_build_object('created_at', page.created_at, 'user_id', page.user_id)
        from page_users page
        order by page.created_at, page.user_id
        limit 1
      ) else null end
    )
  );
end
$$;

-- Keep the existing private limiter unchanged. This narrow service-role
-- wrapper aliases the new read to the already-approved management read bucket.
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
    p_actor_user_id,
    case when p_action = 'management.drilldown' then 'management.dashboard' else p_action end,
    p_request_id,
    p_payload_hash,
    clock_timestamp()
  );
end
$$;

revoke all on function public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamptz,uuid)
  from public, anon, authenticated;
revoke all on function public.admin_consume_rate_limit_v1(uuid,text,uuid,text)
  from public, anon, authenticated;

grant execute on function public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamptz,uuid)
  to service_role;
grant execute on function public.admin_consume_rate_limit_v1(uuid,text,uuid,text)
  to service_role;

do $admin_management_drilldown_postconditions$
begin
  if has_function_privilege('authenticated', 'public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamp with time zone,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamp with time zone,uuid)', 'EXECUTE')
     or has_table_privilege('service_role', 'admin_private.admin_license_grant_trace_v1', 'SELECT') then
    raise exception 'admin management drilldown privileges are unsafe'
      using errcode = 'P0001';
  end if;
end
$admin_management_drilldown_postconditions$;

commit;
