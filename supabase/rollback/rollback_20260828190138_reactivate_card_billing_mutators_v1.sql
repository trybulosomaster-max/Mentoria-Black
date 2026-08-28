-- Safe operational rollback: disable client writers without removing ledger.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '3min';
select pg_advisory_xact_lock(
  hashtextextended('aviora:card-billing-mutator-activation-v1', 0)
);

revoke all on function public.structure_my_card_purchase_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;

do $postcondition$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute')
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.privilege_type = 'EXECUTE'
           and privilege.grantee <> p.proowner
       ) then
      raise exception 'card billing mutator revoke rollback postcondition failed: %',
        v_signature using errcode = 'P0001';
    end if;
  end loop;
end
$postcondition$;

commit;
