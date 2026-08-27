-- AVIORA V82: keep free-form administrative reasons inside admin_private.
--
-- public.access_grants remains the entitlement ledger, but the authenticated
-- target can read its own rows. The reserved AVIORA administrative reference
-- therefore must never carry a free-form reason in that public relation.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:admin-private-reasons-v1', 0));

do $admin_private_reasons_preflight$
begin
  if to_regclass('public.access_grants') is null
     or to_regclass('admin_private.admin_audit_events') is null
     or to_regclass('public.commercial_admin_audit') is null
     or to_regprocedure('admin_private.is_admin_grant_v1(uuid)') is null
     or to_regprocedure('public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)') is null
     or to_regprocedure('public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text)') is null then
    raise exception 'admin private reasons v1 requires the approved administrative stack'
      using errcode = 'P0001';
  end if;
end
$admin_private_reasons_preflight$;

create or replace function admin_private.redact_public_admin_reason_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_new_is_admin_reference boolean :=
    new.source = 'manual'
    and new.access_type in ('manual', 'lifetime')
    and (
      new.external_reference ~
        '^aviora-admin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE)$'
      or new.external_reference ~
        '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE):(manual|lifetime):([0-9]+|lifetime)$'
    );
  v_old_is_admin_reference boolean := false;
  v_new_has_admin_revoker boolean := new.revoked_by is not null;
  v_old_has_admin_revoker boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_old_is_admin_reference :=
      old.source = 'manual'
      and old.access_type in ('manual', 'lifetime')
      and (
        old.external_reference ~
          '^aviora-admin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE)$'
        or old.external_reference ~
          '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE):(manual|lifetime):([0-9]+|lifetime)$'
      );
    v_old_has_admin_revoker := old.revoked_by is not null;
  end if;

  if v_new_is_admin_reference
     or v_old_is_admin_reference
     or v_new_has_admin_revoker
     or v_old_has_admin_revoker then
    new.administrative_reason := null;
  end if;
  return new;
end
$$;

revoke all on function admin_private.redact_public_admin_reason_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists redact_public_admin_reason_v1 on public.access_grants;
create trigger redact_public_admin_reason_v1
before insert or update of administrative_reason, external_reference, source, access_type, revoked_by, status
on public.access_grants
for each row
execute function admin_private.redact_public_admin_reason_v1();

alter table public.access_grants
  drop constraint if exists access_grants_admin_reason_private_check;
alter table public.access_grants
  add constraint access_grants_admin_reason_private_check
  check (
    administrative_reason is null
    or (
      revoked_by is null
      and (
        source <> 'manual'
        or access_type not in ('manual', 'lifetime')
        or external_reference is null
        or (
          external_reference !~
            '^aviora-admin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE)$'
          and external_reference !~
            '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE):(manual|lifetime):([0-9]+|lifetime)$'
        )
      )
    )
  ) not valid;

-- Sanitize the two reserved administrative namespaces and rows carrying an
-- explicit administrative revoker. Unadministered commercial, trial, Kiwify
-- and non-canonical legacy manual rows remain untouched. Both closed audit
-- stores are deliberately not modified.
update public.access_grants grant_row
set administrative_reason = null
where grant_row.administrative_reason is not null
  and (
    grant_row.revoked_by is not null
    or (
      grant_row.source = 'manual'
      and grant_row.access_type in ('manual', 'lifetime')
      and (
        grant_row.external_reference ~
          '^aviora-admin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE)$'
        or grant_row.external_reference ~
          '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE):(manual|lifetime):([0-9]+|lifetime)$'
      )
    )
  );

alter table public.access_grants
  validate constraint access_grants_admin_reason_private_check;

do $admin_private_reasons_postconditions$
begin
  if exists (
    select 1
    from public.access_grants grant_row
    where grant_row.administrative_reason is not null
      and (
        grant_row.revoked_by is not null
        or (
          grant_row.source = 'manual'
          and grant_row.access_type in ('manual', 'lifetime')
          and (
            grant_row.external_reference ~
              '^aviora-admin:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE)$'
            or grant_row.external_reference ~
              '^admin:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(APP|KNOWLEDGE):(manual|lifetime):([0-9]+|lifetime)$'
          )
        )
      )
  ) then
    raise exception 'public AVIORA administrative reasons were not fully redacted'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.access_grants'::regclass
      and trigger_row.tgname = 'redact_public_admin_reason_v1'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception 'public administrative reason redaction trigger is unavailable'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.access_grants'::regclass
      and constraint_row.conname = 'access_grants_admin_reason_private_check'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'public administrative reason privacy constraint is unavailable'
      using errcode = 'P0001';
  end if;

  if has_function_privilege(
       'authenticated',
       'admin_private.redact_public_admin_reason_v1()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'admin_private.redact_public_admin_reason_v1()',
       'EXECUTE'
     ) then
    raise exception 'administrative reason redaction function ACL invariant failed'
      using errcode = 'P0001';
  end if;
end
$admin_private_reasons_postconditions$;

commit;
