begin;

set local lock_timeout='5s';
set local statement_timeout='60s';

select pg_advisory_xact_lock(hashtextextended('mentoria-black:kiwify-webhook-v2-contract',0));

do $preflight$
begin
  if to_regclass('public.commercial_enforcement_state') is null
     or not exists(
       select 1 from public.commercial_enforcement_state
       where singleton and schema_version='commercial_access_v2_kiwify_reconciled'
     )
     or to_regclass('public.products') is null
     or to_regclass('public.commercial_offers') is null
     or to_regclass('public.product_components') is null
     or to_regclass('public.access_grants') is null
     or to_regclass('public.payment_events') is null then
    raise exception 'Kiwify V2 contract requires the exact Commercial Access V2 schema'
      using errcode='P0001';
  end if;

  if (to_regprocedure('public.get_kiwify_webhook_token()') is null)
     <> (to_regprocedure('public.set_kiwify_webhook_token(text)') is null) then
    raise exception 'incomplete Kiwify Vault function contract'
      using errcode='P0001';
  end if;

  if to_regprocedure('public.get_kiwify_webhook_token()') is not null and (
       not exists(
         select 1 from pg_proc p
         where p.oid=to_regprocedure('public.get_kiwify_webhook_token()')
           and p.prosecdef and p.prorettype='text'::regtype
           and exists(
             select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
             where replace(lower(setting),' ','') like 'search_path=%vault%'
           )
       )
       or not exists(
         select 1 from pg_proc p
         where p.oid=to_regprocedure('public.set_kiwify_webhook_token(text)')
           and p.prosecdef and p.prorettype='void'::regtype
           and exists(
             select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
             where replace(lower(setting),' ','') like 'search_path=%vault%'
           )
       )
     ) then
    raise exception 'existing Kiwify Vault function contract is incompatible'
      using errcode='P0001';
  end if;
end
$preflight$;

do $install_vault_contract$
begin
  if to_regprocedure('public.get_kiwify_webhook_token()') is null then
    if not exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='vault' and p.proname='create_secret'
           and p.pronargs>=3 and p.pronargdefaults>=1
       )
       or not exists(
         select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='vault' and p.proname='update_secret'
           and p.pronargs>=4 and p.pronargdefaults>=1
       )
       or to_regclass('vault.decrypted_secrets') is null then
      raise exception 'Supabase Vault is required for the Kiwify webhook token'
        using errcode='P0001';
    end if;

    execute $sql$
      create function public.get_kiwify_webhook_token()
      returns text
      language sql
      security definer
      set search_path=public,vault
      as $body$
        select decrypted_secret
        from vault.decrypted_secrets
        where name='kiwify_webhook_token'
        limit 1
      $body$
    $sql$;

    execute $sql$
      create function public.set_kiwify_webhook_token(p_token text)
      returns void
      language plpgsql
      security definer
      set search_path=public,vault
      as $body$
      declare
        v_existing_id uuid;
        v_token text:=btrim(p_token);
      begin
        if v_token is null or length(v_token)<32 or length(v_token)>255 then
          raise exception 'invalid webhook token' using errcode='22023';
        end if;
        select id into v_existing_id
        from vault.secrets where name='kiwify_webhook_token' limit 1;
        if v_existing_id is null then
          perform vault.create_secret(
            v_token,'kiwify_webhook_token','Kiwify webhook authentication token'
          );
        else
          perform vault.update_secret(
            v_existing_id,v_token,'kiwify_webhook_token','Kiwify webhook authentication token'
          );
        end if;
      end
      $body$
    $sql$;
  end if;
end
$install_vault_contract$;

revoke all on function public.get_kiwify_webhook_token() from public,anon,authenticated;
revoke all on function public.set_kiwify_webhook_token(text) from public,anon,authenticated;
grant execute on function public.get_kiwify_webhook_token() to service_role;
grant execute on function public.set_kiwify_webhook_token(text) to service_role;

create or replace function public.get_kiwify_webhook_contract_v2()
returns text
language sql
stable
security invoker
set search_path=pg_catalog
as $$
  select 'commercial_access_v2_kiwify_webhook_v1'::text
$$;

create or replace function public.resolve_kiwify_product_v2(
  p_external_product_id text,
  p_product_name text
)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
declare
  v_codes text[];
  v_normalized_name text:=lower(btrim(coalesce(p_product_name,'')));
begin
  if p_external_product_id is not null and (
    length(p_external_product_id)>200 or p_external_product_id!~'^[A-Za-z0-9_&.-]+$'
  ) then
    raise exception 'invalid Kiwify product id' using errcode='22023';
  end if;

  if p_external_product_id is not null then
    select array_agg(p.code order by p.code) into v_codes
    from public.commercial_offers o
    join public.products p on p.id=o.product_id
    where o.provider='kiwify'
      and o.external_offer_id=p_external_product_id
      and o.active and p.active;
    if coalesce(cardinality(v_codes),0)>1 then
      raise exception 'ambiguous Kiwify product mapping' using errcode='P0001';
    end if;
    if cardinality(v_codes)=1 then return v_codes[1]; end if;
  end if;

  if v_normalized_name='mentoria black' and exists(
    select 1 from public.products where code='APP' and slug='mentoria-black' and active
  ) then
    return 'APP';
  end if;
  return null;
end
$$;

create or replace function public.process_kiwify_webhook_event_v2(
  p_external_event_id text,
  p_event_type text,
  p_action text,
  p_user_id uuid,
  p_product_code text,
  p_external_customer_id text,
  p_external_purchase_id text,
  p_external_subscription_id text,
  p_access_until timestamptz,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_event public.payment_events%rowtype;
  v_sold public.products%rowtype;
  v_component record;
  v_grant public.access_grants%rowtype;
  v_grant_id uuid;
  v_grants_touched integer:=0;
  v_rows integer:=0;
  v_require_period boolean:=false;
  v_grace_hours integer:=72;
  v_status text;
  v_error text;
begin
  if current_user not in ('postgres','service_role','supabase_admin')
     and coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception 'Kiwify V2 processor is server-only' using errcode='42501';
  end if;
  if p_external_event_id is null or length(p_external_event_id)>200
     or p_external_event_id!~'^[A-Za-z0-9_&.-]+$'
     or p_event_type is null or p_event_type!~'^[a-z][a-z0-9_]{1,99}$'
     or p_action not in ('activate','renewal','cancel','late','expire','refund','partial_refund','chargeback','informational')
     or p_payload_hash is null or p_payload_hash!~'^[0-9a-f]{64}$' then
    raise exception 'invalid Kiwify V2 event contract' using errcode='22023';
  end if;
  if exists(
    select 1 from unnest(array[p_external_customer_id,p_external_purchase_id,p_external_subscription_id]) value
    where value is not null and (length(value)>200 or value!~'^[A-Za-z0-9_&.-]+$')
  ) then
    raise exception 'invalid Kiwify external identifier' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kiwify:production:'||p_external_event_id,0));
  select * into v_event
  from public.payment_events
  where provider='kiwify' and environment='production'
    and external_event_id=p_external_event_id
  for update;

  if found then
    if v_event.event_type<>p_event_type or v_event.payload_hash<>p_payload_hash then
      raise exception 'Kiwify event identity drift' using errcode='P0001';
    end if;
    if v_event.processed or v_event.status in ('processed','ignored','administrative_review') then
      return jsonb_build_object('status',v_event.status,'duplicate',true,'grants_touched',0);
    end if;
    update public.payment_events
    set status='processing',processing_attempts=processing_attempts+1,
        next_retry_at=null,last_error_at=null,error_code=null,
        user_id=coalesce(p_user_id,user_id),
        external_customer_id=coalesce(p_external_customer_id,external_customer_id),
        external_purchase_id=coalesce(p_external_purchase_id,external_purchase_id),
        external_payment_id=coalesce(p_external_purchase_id,external_payment_id),
        external_subscription_id=coalesce(p_external_subscription_id,external_subscription_id)
    where id=v_event.id returning * into v_event;
  else
    insert into public.payment_events(
      provider,event_id,environment,external_event_id,event_type,user_id,received_at,
      status,processing_attempts,payload_hash,external_customer_id,
      external_purchase_id,external_payment_id,external_subscription_id,payload,processed
    ) values(
      'kiwify',p_external_event_id,'production',p_external_event_id,p_event_type,p_user_id,
      clock_timestamp(),'processing',1,p_payload_hash,p_external_customer_id,
      p_external_purchase_id,p_external_purchase_id,p_external_subscription_id,null,false
    ) returning * into v_event;
  end if;

  begin
    if p_action='informational' then
      update public.payment_events
      set status='ignored',processed=true,processed_at=clock_timestamp(),error_code=null
      where id=v_event.id;
      return jsonb_build_object('status','ignored','duplicate',false,'grants_touched',0);
    end if;

    if p_action='partial_refund' then
      update public.payment_events
      set status='administrative_review',processed=true,processed_at=clock_timestamp(),
          error_code='partial_refund_requires_review'
      where id=v_event.id;
      return jsonb_build_object('status','administrative_review','duplicate',false,'grants_touched',0);
    end if;

    if p_action in ('activate','renewal') then
      if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
        raise exception 'kiwify_user_identity_missing';
      end if;
      select * into v_sold from public.products
      where code=upper(btrim(coalesce(p_product_code,''))) and active;
      if not found then raise exception 'kiwify_product_unmapped'; end if;

      if exists(
        select 1 from public.commercial_offers o
        where o.product_id=v_sold.id and o.provider='kiwify'
          and o.billing_mode='subscription' and o.active
      ) then
        v_require_period:=true;
        select greatest(coalesce(max(o.grace_period_hours),72),0) into v_grace_hours
        from public.commercial_offers o
        where o.product_id=v_sold.id and o.provider='kiwify' and o.active;
      end if;
      if v_require_period and (p_external_subscription_id is null or p_access_until is null) then
        raise exception 'kiwify_subscription_period_missing';
      end if;

      -- Pre-check every APP leg before writing any component, preventing partial bundles.
      for v_component in
        select p.id,p.code
        from public.products p where p.id=v_sold.id and v_sold.product_kind='entitlement'
        union all
        select p.id,p.code from public.product_components pc
        join public.products p on p.id=pc.component_product_id
        where pc.bundle_product_id=v_sold.id
      loop
        if p_action='renewal' and v_component.code<>'APP' then continue; end if;
        if v_component.code='APP' then
          perform pg_advisory_xact_lock(hashtextextended('kiwify-grant:'||p_user_id::text||':'||v_component.id::text,0));
          select * into v_grant
          from public.access_grants g
          where g.user_id=p_user_id and g.product_id=v_component.id
            and g.source='kiwify' and g.environment in ('legacy','production')
            and g.access_type='paid'
            and (
              (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id)
              or (p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id)
              or (p_action='renewal' and g.status in ('active','grace_period','past_due','suspended'))
              or (not v_require_period and g.status in ('active','grace_period','past_due','suspended'))
            )
          order by
            case when p_external_purchase_id is not null and g.external_reference=p_external_purchase_id then 1
                 when p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id then 2
                 else 3 end,
            g.created_at desc
          limit 1 for update;
          if not found and exists(
            select 1 from public.access_grants g
            where g.user_id=p_user_id and g.product_id=v_component.id
              and g.source='kiwify' and g.environment='production'
              and g.access_type='paid' and g.status in ('active','grace_period')
          ) then
            raise exception 'kiwify_active_grant_conflict';
          end if;
        end if;
      end loop;

      for v_component in
        select p.id,p.code
        from public.products p where p.id=v_sold.id and v_sold.product_kind='entitlement'
        union all
        select p.id,p.code from public.product_components pc
        join public.products p on p.id=pc.component_product_id
        where pc.bundle_product_id=v_sold.id
      loop
        if p_action='renewal' and v_component.code<>'APP' then continue; end if;
        v_grant_id:=null;

        if v_component.code='KNOWLEDGE' and exists(
          select 1 from public.access_grants g
          where g.user_id=p_user_id and g.product_id=v_component.id
            and g.access_type in ('lifetime','manual') and g.status='active'
        ) then
          continue;
        end if;

        select g.id into v_grant_id
        from public.access_grants g
        where g.user_id=p_user_id and g.product_id=v_component.id
          and g.source='kiwify' and g.environment in ('legacy','production')
          and (
            (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id)
            or (v_component.code='APP' and p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id)
            or (v_component.code='APP' and (p_action='renewal' or not v_require_period)
                and g.status in ('active','grace_period','past_due','suspended'))
          )
        order by g.created_at desc limit 1 for update;

        if v_grant_id is null then
          insert into public.access_grants(
            user_id,product_id,access_type,source,environment,status,started_at,expires_at,
            external_customer_id,external_purchase_id,external_reference,external_subscription_id
          ) values(
            p_user_id,v_component.id,case when v_component.code='KNOWLEDGE' then 'lifetime' else 'paid' end,
            'kiwify','production','active',clock_timestamp(),
            case when v_component.code='APP' then p_access_until else null end,
            p_external_customer_id,p_external_purchase_id,p_external_purchase_id,p_external_subscription_id
          ) returning id into v_grant_id;
        else
          update public.access_grants
          set access_type=case when v_component.code='KNOWLEDGE' then 'lifetime' else 'paid' end,
              status='active',revoked_at=null,grace_until=null,
              environment='production',
              external_customer_id=coalesce(p_external_customer_id,external_customer_id),
              external_purchase_id=coalesce(external_purchase_id,p_external_purchase_id),
              external_reference=coalesce(external_reference,p_external_purchase_id),
              external_subscription_id=coalesce(p_external_subscription_id,external_subscription_id),
              expires_at=case when v_component.code='KNOWLEDGE' then null
                when p_access_until is null then expires_at
                else greatest(coalesce(expires_at,p_access_until),p_access_until) end
          where id=v_grant_id;
        end if;
        v_grants_touched:=v_grants_touched+1;

        if v_component.code='APP' then
          update public.product_trials
          set state='converted',converted_at=coalesce(converted_at,clock_timestamp())
          where user_id=p_user_id and product_id=v_component.id and state in ('active','expired');
          update public.access_grants
          set status='expired'
          where user_id=p_user_id and product_id=v_component.id and access_type='trial'
            and status in ('active','grace_period','past_due');
        end if;
      end loop;

    elsif p_action in ('refund','chargeback') then
      if p_external_purchase_id is null and p_external_subscription_id is null then
        raise exception 'kiwify_purchase_identity_missing';
      end if;
      v_status:=case when p_action='refund' then 'refunded' else 'chargeback' end;
      update public.access_grants g
      set status=v_status,revoked_at=clock_timestamp()
      where g.source='kiwify' and g.environment in ('legacy','production')
        and (
          (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id)
          or (
            p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id
            and exists(select 1 from public.products p where p.id=g.product_id and p.code='APP')
          )
        );
      get diagnostics v_grants_touched=row_count;
      if v_grants_touched=0 then raise exception 'kiwify_grant_link_not_found'; end if;

    elsif p_action in ('cancel','late','expire') then
      if p_external_purchase_id is null and p_external_subscription_id is null then
        raise exception 'kiwify_subscription_identity_missing';
      end if;
      if p_action='cancel' then
        update public.access_grants g
        set expires_at=coalesce(p_access_until,expires_at),
            status=case when coalesce(p_access_until,expires_at)>clock_timestamp() then 'active' else status end
        where g.source='kiwify' and g.environment in ('legacy','production')
          and exists(select 1 from public.products p where p.id=g.product_id and p.code='APP')
          and ((p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id)
            or (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id));
      elsif p_action='late' then
        update public.access_grants g
        set status='grace_period',
            grace_until=greatest(coalesce(g.expires_at,clock_timestamp()),clock_timestamp())
              +make_interval(hours=>v_grace_hours)
        where g.source='kiwify' and g.environment in ('legacy','production')
          and exists(select 1 from public.products p where p.id=g.product_id and p.code='APP')
          and ((p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id)
            or (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id));
      else
        update public.access_grants g set status='expired'
        where g.source='kiwify' and g.environment in ('legacy','production')
          and exists(select 1 from public.products p where p.id=g.product_id and p.code='APP')
          and ((p_external_subscription_id is not null and g.external_subscription_id=p_external_subscription_id)
            or (p_external_purchase_id is not null and g.external_reference=p_external_purchase_id));
      end if;
      get diagnostics v_grants_touched=row_count;
      if v_grants_touched=0 then raise exception 'kiwify_grant_link_not_found'; end if;
    end if;

    update public.payment_events
    set status='processed',processed=true,processed_at=clock_timestamp(),error_code=null,
        user_id=coalesce(p_user_id,user_id)
    where id=v_event.id;
    return jsonb_build_object('status','processed','duplicate',false,'grants_touched',v_grants_touched);
  exception when others then
    v_error:=sqlerrm;
    update public.payment_events
    set status=case when v_error in (
          'kiwify_product_unmapped','kiwify_active_grant_conflict',
          'kiwify_purchase_identity_missing','kiwify_subscription_identity_missing',
          'kiwify_grant_link_not_found'
        ) then 'administrative_review' else 'failed' end,
        processed=case when v_error in (
          'kiwify_product_unmapped','kiwify_active_grant_conflict',
          'kiwify_purchase_identity_missing','kiwify_subscription_identity_missing',
          'kiwify_grant_link_not_found'
        ) then true else false end,
        processed_at=case when v_error in (
          'kiwify_product_unmapped','kiwify_active_grant_conflict',
          'kiwify_purchase_identity_missing','kiwify_subscription_identity_missing',
          'kiwify_grant_link_not_found'
        ) then clock_timestamp() else null end,
        error_code=left(v_error,120),last_error_at=clock_timestamp(),
        next_retry_at=case when v_error in (
          'kiwify_product_unmapped','kiwify_active_grant_conflict',
          'kiwify_purchase_identity_missing','kiwify_subscription_identity_missing',
          'kiwify_grant_link_not_found'
        ) then null else clock_timestamp()+interval '15 minutes' end
    where id=v_event.id;
    return jsonb_build_object(
      'status',case when v_error in (
        'kiwify_product_unmapped','kiwify_active_grant_conflict',
        'kiwify_purchase_identity_missing','kiwify_subscription_identity_missing',
        'kiwify_grant_link_not_found'
      ) then 'administrative_review' else 'retryable' end,
      'duplicate',false,'grants_touched',0
    );
  end;
end
$$;

revoke all on function public.get_kiwify_webhook_contract_v2() from public,anon,authenticated;
revoke all on function public.resolve_kiwify_product_v2(text,text) from public,anon,authenticated;
revoke all on function public.process_kiwify_webhook_event_v2(text,text,text,uuid,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.get_kiwify_webhook_contract_v2() to service_role;
grant execute on function public.resolve_kiwify_product_v2(text,text) to service_role;
grant execute on function public.process_kiwify_webhook_event_v2(text,text,text,uuid,text,text,text,text,timestamptz,text) to service_role;

comment on function public.get_kiwify_webhook_contract_v2() is
  'Server-only feature marker for the dual-compatible Kiwify writer.';
comment on function public.resolve_kiwify_product_v2(text,text) is
  'Server-only Kiwify offer resolver; legacy name fallback maps only Mentoria Black to APP.';
comment on function public.process_kiwify_webhook_event_v2(text,text,text,uuid,text,text,text,text,timestamptz,text) is
  'Transactional, idempotent Kiwify Commercial V2 event and grant processor.';

commit;
