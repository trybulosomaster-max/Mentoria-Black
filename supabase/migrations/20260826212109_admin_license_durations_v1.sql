-- LOCAL PROPOSAL ONLY. This incremental migration extends AVIORA
-- administrative grants without changing commercial entitlement semantics.
begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-license-durations-v1', 0));

alter table admin_private.admin_audit_events
  drop constraint admin_audit_license_kind_check;

alter table admin_private.admin_audit_events
  add constraint admin_audit_license_kind_check
  check (license_kind is null or license_kind in ('monthly', 'annual', 'lifetime'));

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
          'access_type', g.access_type,
          'license_kind', provenance.license_kind,
          'source', g.source,
          'status', g.status, 'started_at', g.started_at,
          'expires_at', g.expires_at, 'grace_until', g.grace_until,
          'administrative', admin_private.is_admin_grant_v1(g.id),
          'external_reference', case when admin_private.is_admin_grant_v1(g.id) then g.external_reference else null end
        ) order by g.created_at desc)
        from public.access_grants g
        join public.products p on p.id = g.product_id
        left join lateral (
          select audit.license_kind
          from admin_private.admin_audit_events audit
          join admin_private.admin_operation_requests operation
            on operation.request_id = audit.request_id
           and operation.actor_kind = 'user'
           and operation.actor_user_id = audit.actor_user_id
           and operation.action = 'licenses.grant'
           and operation.status = 'succeeded'
          where audit.grant_id = g.id
            and audit.action = 'licenses.grant'
            and audit.result = 'succeeded'
            and audit.actor_kind = 'user'
            and audit.actor_user_id = g.granted_by
            and audit.target_user_id = g.user_id
            and audit.product_code = p.code
            and audit.license_kind in ('monthly', 'annual', 'lifetime')
            and g.external_reference =
              'aviora-admin:v1:' || audit.request_id::text || ':' || p.code
          order by audit.created_at, audit.id
          limit 1
        ) provenance on true
        where g.user_id = u.id
      ), '[]'::jsonb)
    )
    from auth.users u
    left join admin_private.admin_members m on m.user_id = u.id
    where u.id = p_target_user_id
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
  if coalesce(p_license_kind, '') not in ('monthly', 'annual', 'lifetime') then
    raise exception 'license kind must be monthly, annual, or lifetime' using errcode = '22023';
  end if;
  if v_actor_role = 'STAFF' and p_license_kind = 'lifetime' then
    raise exception 'STAFF cannot grant lifetime licenses' using errcode = '42501';
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
  v_access_type := case when p_license_kind = 'lifetime' then 'lifetime' else 'manual' end;
  v_expires_at := case p_license_kind
    when 'monthly' then v_now + interval '1 month'
    when 'annual' then v_now + interval '1 year'
    else null
  end;

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
      'license_kind', p_license_kind,
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
  v_license_kind text;
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

  select audit.license_kind into v_license_kind
  from admin_private.admin_audit_events audit
  join admin_private.admin_operation_requests operation
    on operation.request_id = audit.request_id
   and operation.actor_kind = 'user'
   and operation.actor_user_id = audit.actor_user_id
   and operation.action = 'licenses.grant'
   and operation.status = 'succeeded'
  where audit.grant_id = p_grant_id
    and audit.action = 'licenses.grant'
    and audit.result = 'succeeded'
    and audit.actor_kind = 'user'
    and audit.actor_user_id = v_grant.granted_by
    and audit.target_user_id = v_grant.user_id
    and audit.product_code = v_product_code
    and audit.license_kind in ('monthly', 'annual', 'lifetime')
    and v_grant.external_reference =
      'aviora-admin:v1:' || audit.request_id::text || ':' || v_product_code
  order by audit.created_at, audit.id
  limit 1;
  if v_license_kind is null then
    raise exception 'administrative grant license kind is unavailable' using errcode = '42501';
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
    v_license_kind, p_grant_id, p_reason, v_result
  );
  v_response := jsonb_build_object(
    'request_id', p_request_id,
    'target_user_id', p_target_user_id,
    'grant_id', p_grant_id,
    'license_kind', v_license_kind,
    'revoked', v_result = 'succeeded',
    'result', v_result,
    'idempotent', false
  );
  return admin_private.complete_operation_v1(p_request_id, v_response);
end
$$;

revoke all on function public.admin_get_user_access_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text) from public, anon, authenticated;

grant execute on function public.admin_get_user_access_v1(uuid,uuid) to service_role;
grant execute on function public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text) to service_role;
grant execute on function public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text) to service_role;

do $postconditions$
begin
  if has_function_privilege('authenticated', 'public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text)', 'EXECUTE') then
    raise exception 'administrative license RPC ACL invariant failed' using errcode = 'P0001';
  end if;
end
$postconditions$;

commit;
