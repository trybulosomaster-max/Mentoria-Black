-- Application-first emergency rollback. This intentionally preserves every V82
-- column, index, constraint and financial row while disabling new RPC writes.
begin;
set local lock_timeout='15s';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:v82:production-chain',0));

do $rollback$
declare v_signature text;v_oid regprocedure;
begin
  foreach v_signature in array array[
    'public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)',
    'public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)',
    'public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text)',
    'public.reverse_structured_operation_v82(uuid,uuid,date,text)',
    'public.materialize_recurring_occurrences_v82(date)',
    'public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is not null then
      execute format('revoke all on function %s from authenticated,anon,public',v_oid);
    end if;
  end loop;
end$rollback$;

commit;
