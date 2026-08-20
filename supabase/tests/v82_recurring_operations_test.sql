begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
  ('61111111-1111-4111-8111-111111111111','recurring-a@example.invalid'),
  ('62222222-2222-4222-8222-222222222222','recurring-b@example.invalid');
insert into accounts(id,user_id,name,opening_balance,statement_balance) values
  ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','61111111-1111-4111-8111-111111111111','A source',1000,1000),
  ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','61111111-1111-4111-8111-111111111111','A destination',200,200),
  ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','62222222-2222-4222-8222-222222222222','B account',900,900);
insert into assets(id,user_id,name,opening_value,current_value) values
  ('6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','61111111-1111-4111-8111-111111111111','A asset',500,500),
  ('6fffffff-ffff-4fff-8fff-fffffffffff1','62222222-2222-4222-8222-222222222222','B asset',700,700);
insert into goals(id,user_id,name,target,current) values
  ('60000000-0000-4000-8000-000000000001','61111111-1111-4111-8111-111111111111','A goal',1000,0);

select has_column('public','recurring','source_account_id','recurring source account exists');
select has_column('public','recurring','destination_account_id','recurring destination account exists');
select has_column('public','recurring','asset_id','recurring asset exists');
select has_index('public','recurring','recurring_user_source_account_v82_idx','source account index exists');
select has_index('public','recurring','recurring_user_destination_account_v82_idx','destination account index exists');
select has_index('public','recurring','recurring_user_asset_v82_idx','asset index exists');
select has_index('public','recurring','recurring_user_active_next_date_v82_idx','active schedule index exists');
select ok(not (select convalidated from pg_constraint where conname='recurring_investment_shape_v82'),'investment check preserves legacy rows');
select ok(not (select convalidated from pg_constraint where conname='recurring_transfer_shape_v82'),'transfer check preserves legacy rows');
select ok(not (select convalidated from pg_constraint where conname='recurring_rescue_shape_v82'),'rescue check preserves legacy rows');

set local role authenticated;
set local "request.jwt.claim.sub"='61111111-1111-4111-8111-111111111111';

select lives_ok($$insert into recurring(id,user_id,name,type,amount,account_id,frequency,"interval",start_date,next_date,end_date,active)
  values('61000000-0000-4000-8000-000000000001','61111111-1111-4111-8111-111111111111','Income','receita',100,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','monthly',1,current_date,current_date,current_date,true)$$,'income requires no structured links');
select lives_ok($$insert into recurring(id,user_id,name,type,amount,account_id,frequency,"interval",start_date,next_date,end_date,active)
  values('61000000-0000-4000-8000-000000000002','61111111-1111-4111-8111-111111111111','Expense','despesa',40,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','monthly',1,current_date,current_date,current_date,true)$$,'expense requires no structured links');
select lives_ok($$insert into recurring(id,user_id,name,type,amount,account_id,source_account_id,asset_id,frequency,"interval",start_date,next_date,end_date,active,goal_id,goal_effect)
  values('61000000-0000-4000-8000-000000000003','61111111-1111-4111-8111-111111111111','Investment','investimento',80,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','monthly',1,current_date,current_date,current_date,true,'60000000-0000-4000-8000-000000000001','contribution')$$,'investment stores explicit account and asset');
select lives_ok($$insert into recurring(id,user_id,name,type,amount,account_id,source_account_id,destination_account_id,frequency,"interval",start_date,next_date,end_date,active)
  values('61000000-0000-4000-8000-000000000004','61111111-1111-4111-8111-111111111111','Transfer','transferencia',70,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','monthly',1,current_date,current_date,current_date,true)$$,'transfer stores distinct accounts');
select lives_ok($$insert into recurring(id,user_id,name,type,amount,account_id,destination_account_id,asset_id,frequency,"interval",start_date,next_date,end_date,active)
  values('61000000-0000-4000-8000-000000000005','61111111-1111-4111-8111-111111111111','Rescue','resgate',30,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','monthly',1,current_date,current_date,current_date,true)$$,'rescue stores explicit asset and account');

select throws_ok($$insert into recurring(user_id,name,type,amount,next_date) values('61111111-1111-4111-8111-111111111111','Invalid investment','investimento',10,current_date)$$,'23514',null,'investment without links rejected');
select throws_ok($$insert into recurring(user_id,name,type,amount,source_account_id,next_date) values('61111111-1111-4111-8111-111111111111','Invalid investment asset','investimento',10,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',current_date)$$,'23514',null,'investment without asset rejected');
select throws_ok($$insert into recurring(user_id,name,type,amount,source_account_id,destination_account_id,next_date) values('61111111-1111-4111-8111-111111111111','Invalid transfer','transferencia',10,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',current_date)$$,'23514',null,'same-account transfer rejected');
select throws_ok($$insert into recurring(user_id,name,type,amount,asset_id,next_date) values('61111111-1111-4111-8111-111111111111','Invalid rescue','resgate',10,'6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',current_date)$$,'23514',null,'rescue without destination rejected');
select throws_ok($$insert into recurring(user_id,name,type,amount,source_account_id,asset_id,next_date) values('61111111-1111-4111-8111-111111111111','Cross investment','investimento',10,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6fffffff-ffff-4fff-8fff-fffffffffff1',current_date)$$,'23503',null,'cross-user asset FK rejected');
select throws_ok($$insert into recurring(user_id,name,type,amount,source_account_id,destination_account_id,next_date) values('61111111-1111-4111-8111-111111111111','Cross transfer','transferencia',10,'6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',current_date)$$,'23503',null,'cross-user account FK rejected');

insert into recurring(id,user_id,name,type,amount,frequency,"interval",start_date,next_date,end_date,active)
values('61ffffff-ffff-4fff-8fff-ffffffffffff','61111111-1111-4111-8111-111111111111','Unsupported legacy type','misterio',1,'monthly',1,current_date,current_date,current_date,true);
select throws_ok($$select materialize_recurring_occurrences_v82(current_date)$$,'23514',null,'one invalid series aborts the materialization batch');
select results_eq($$select count(*) from transactions where recurring_series_id::text like '61%'$$,'values (0::bigint)','atomic failure leaves no occurrence rows');
select results_eq($$select count(*) from recurring where id::text like '61000000%' and next_date=current_date$$,'values (5::bigint)','atomic failure does not advance schedules');
delete from recurring where id='61ffffff-ffff-4fff-8fff-ffffffffffff';

select results_eq($$select count(*) from materialize_recurring_occurrences_v82(current_date)$$,'values (5::bigint)','five canonical occurrences materialize together');
select results_eq($$select count(*) from transactions where recurring_series_id::text like '61000000%'$$,'values (5::bigint)','one occurrence exists for each series');
select results_eq($$select count(*) from transactions where recurring_series_id is not null and recurring_occurrence_date=transaction_date$$,'values (5::bigint)','series and occurrence date are copied');
select results_eq($$select count(*) from transactions where recurring_series_id='61000000-0000-4000-8000-000000000003' and transaction_type='investimento' and source_account_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and asset_id='6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'$$,'values (1::bigint)','investment occurrence preserves account and asset');
select results_eq($$select count(*) from transactions where recurring_series_id='61000000-0000-4000-8000-000000000004' and transaction_type='transferencia' and source_account_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and destination_account_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'$$,'values (1::bigint)','transfer occurrence preserves both accounts');
select results_eq($$select count(*) from transactions where recurring_series_id='61000000-0000-4000-8000-000000000005' and transaction_type='resgate' and asset_id='6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1' and destination_account_id='6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'$$,'values (1::bigint)','rescue occurrence preserves asset and destination');
select results_eq($$select count(*) from transactions where recurring_series_id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002') and source_account_id is null and destination_account_id is null and asset_id is null$$,'values (2::bigint)','income and expense gain no improper structured links');
select results_eq($$select count(*) from materialize_recurring_occurrences_v82(current_date)$$,'values (0::bigint)','second materialization returns no duplicates');
select results_eq($$select count(*) from transactions where recurring_series_id::text like '61000000%'$$,'values (5::bigint)','idempotent materialization remains at five rows');
select results_eq($$select count(distinct (user_id,recurring_series_id,recurring_occurrence_date)) from transactions where recurring_series_id::text like '61000000%'$$,'values (5::bigint)','canonical occurrence identity is unique');

select results_eq($$select transaction_type from create_investment_entry_v82('63000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',25,current_date,'Investimentos','UI investment','Fundo','PIX','Synthetic note','60000000-0000-4000-8000-000000000001','contribution')$$,$$values ('investimento'::text)$$,'common UI investment uses canonical RPC');
select results_eq($$select count(*) from transactions where operation_id='63000000-0000-4000-8000-000000000001' and account_id=source_account_id and asset_id is not null and goal_id is not null$$,'values (1::bigint)','investment wrapper preserves canonical and UI metadata');
select lives_ok($$select create_investment_entry_v82('63000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',25,current_date,'Investimentos','UI investment','Fundo','PIX','Synthetic note','60000000-0000-4000-8000-000000000001','contribution')$$,'common investment retry is idempotent');
select throws_ok($$select create_investment_entry_v82('63000000-0000-4000-8000-000000000001','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6eeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',25,current_date,'Investimentos','UI investment','Other','PIX','Synthetic note','60000000-0000-4000-8000-000000000001','contribution')$$,'23505',null,'metadata conflict is rejected');
select throws_ok($$select create_investment_entry_v82('63000000-0000-4000-8000-000000000002','6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','6fffffff-ffff-4fff-8fff-fffffffffff1',25,current_date,'Investimentos')$$,'42501',null,'common investment rejects cross-user asset');

select ok(not has_function_privilege('anon','public.materialize_recurring_occurrences_v82(date)','execute'),'anon cannot materialize recurring operations');
select ok(has_function_privilege('authenticated','public.materialize_recurring_occurrences_v82(date)','execute'),'authenticated can materialize recurring operations');
select ok(not (select prosecdef from pg_proc where oid='public.materialize_recurring_occurrences_v82(date)'::regprocedure),'materializer is security invoker');
select ok((select proconfig=array['search_path=public, pg_temp']::text[] from pg_proc where oid='public.materialize_recurring_occurrences_v82(date)'::regprocedure),'materializer search_path is controlled');
select results_eq($$select count(*) from recurring where user_id='62222222-2222-4222-8222-222222222222'$$,'values (0::bigint)','A cannot see B recurring rows');

select * from finish();
rollback;
