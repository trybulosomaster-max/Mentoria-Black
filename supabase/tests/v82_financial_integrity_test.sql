begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(71);

-- Synthetic users and resources. No production data is used.
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','local-a@example.invalid'),
  ('22222222-2222-4222-8222-222222222222','local-b@example.invalid');
insert into accounts(id,user_id,name,opening_balance,statement_balance) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','A checking',1000,1000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','A savings',200,200),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222','B checking',900,900);
insert into cards(id,user_id,name) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','11111111-1111-4111-8111-111111111111','A card'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','22222222-2222-4222-8222-222222222222','B card');
insert into assets(id,user_id,name,opening_value,current_value) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','11111111-1111-4111-8111-111111111111','A fund',500,500),
  ('ffffffff-ffff-4fff-8fff-fffffffffff1','22222222-2222-4222-8222-222222222222','B fund',700,700);
insert into liabilities(id,user_id,name,balance) values
  ('11111111-1111-4111-8111-111111110101','11111111-1111-4111-8111-111111111111','A loan',300),
  ('22222222-2222-4222-8222-222222220201','22222222-2222-4222-8222-222222222222','B loan',400);
insert into recurring(id,user_id,name,type,amount,account_id,card_id,next_date) values
  ('33333333-3333-4333-8333-333333330301','11111111-1111-4111-8111-111111111111','A recurring','despesa',10,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','2026-08-01'),
  ('44444444-4444-4444-8444-444444440401','22222222-2222-4222-8222-222222222222','B recurring','despesa',10,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','2026-08-01');
insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,account_id)
values('22222222-2222-4222-8222-222222222222','2026-08-01','B private',10,'receita','realizado','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

select has_column('public','transactions','source_account_id','source_account_id exists');
select has_column('public','transactions','destination_account_id','destination_account_id exists');
select has_column('public','transactions','asset_id','asset_id exists');
select has_column('public','transactions','liability_id','liability_id exists');
select has_column('public','transactions','recurring_series_id','recurring_series_id exists');
select has_column('public','transactions','recurring_occurrence_date','recurring_occurrence_date exists');
select has_column('public','transactions','installment_series_id','installment_series_id exists');
select has_column('public','transactions','installment_number','installment_number exists');
select has_column('public','transactions','operation_id','operation_id exists');
select has_column('public','transactions','reversal_of_id','reversal_of_id exists');
select has_column('public','accounts','balance_as_of','accounts balance_as_of exists');
select has_column('public','assets','opening_value','assets opening_value exists');
select has_column('public','assets','value_as_of','assets value_as_of exists');
select has_index('public','transactions','transactions_user_operation_uidx','operation id index exists');
select has_index('public','transactions','transactions_user_recurring_occurrence_uidx','recurrence identity index exists');
select has_index('public','transactions','transactions_user_installment_uidx','installment identity index exists');
select has_index('public','transactions','transactions_user_reversal_uidx','reversal identity index exists');
select ok((select relrowsecurity from pg_class where oid='public.transactions'::regclass),'transactions RLS enabled');

set local role authenticated;
set local "request.jwt.claim.sub"='11111111-1111-4111-8111-111111111111';

select results_eq('select count(*) from accounts','values (2::bigint)','A reads only own accounts');
select results_eq($$select count(*) from accounts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'$$,'values (0::bigint)','A cannot read B account');
select results_eq($$with changed as (update accounts set name='blocked' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' returning 1) select count(*) from changed$$,'values (0::bigint)','A cannot update B account');
select results_eq($$with removed as (delete from accounts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' returning 1) select count(*) from removed$$,'values (0::bigint)','A cannot delete B account');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,account_id) values('11111111-1111-4111-8111-111111111111','2026-08-02','own account',1,'receita','realizado','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,'A can link own account');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,account_id) values('11111111-1111-4111-8111-111111111111','2026-08-02','cross account',1,'receita','realizado','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$$,'23503',null,'A cannot link B account');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,card_id) values('11111111-1111-4111-8111-111111111111','2026-08-02','own card',1,'despesa','realizado','cccccccc-cccc-4ccc-8ccc-ccccccccccc1')$$,'A can link own card');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,card_id) values('11111111-1111-4111-8111-111111111111','2026-08-02','cross card',1,'despesa','realizado','dddddddd-dddd-4ddd-8ddd-ddddddddddd1')$$,'23503',null,'A cannot link B card');
select lives_ok($$insert into recurring(user_id,name,type,amount,account_id,card_id,next_date) values('11111111-1111-4111-8111-111111111111','own recurring','despesa',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','2026-09-01')$$,'A recurring links own resources');
select throws_ok($$insert into recurring(user_id,name,type,amount,account_id,next_date) values('11111111-1111-4111-8111-111111111111','cross recurring account','despesa',1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','2026-09-01')$$,'23503',null,'A recurring cannot link B account');
select throws_ok($$insert into recurring(user_id,name,type,amount,card_id,next_date) values('11111111-1111-4111-8111-111111111111','cross recurring card','despesa',1,'dddddddd-dddd-4ddd-8ddd-ddddddddddd1','2026-09-01')$$,'23503',null,'A recurring cannot link B card');
select results_eq($$select count(*) from transactions where description='B private'$$,'values (0::bigint)','A cannot read B transactions');
select throws_ok($$update transactions set user_id='22222222-2222-4222-8222-222222222222' where description='own account'$$,'42501',null,'WITH CHECK prevents ownership reassignment');

select results_eq($$select transaction_type from create_transfer_v82('90000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',100,'2026-08-10')$$,$$values ('transferencia'::text)$$,'valid transfer is created');
select throws_ok($$select create_transfer_v82('90000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',10,'2026-08-10')$$,'23514',null,'same-account transfer rejected');
select throws_ok($$select create_transfer_v82('90000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',10,'2026-08-10')$$,'42501',null,'cross-user transfer rejected');
select results_eq($$select count(*) from transactions where operation_id in ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000003')$$,'values (0::bigint)','failed transfers leave no partial row');
select lives_ok($$select create_transfer_v82('90000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',100,'2026-08-10')$$,'same operation payload is idempotent');
select results_eq($$select count(*) from transactions where operation_id='90000000-0000-4000-8000-000000000001'$$,'values (1::bigint)','idempotent transfer exists once');
select throws_ok($$select create_transfer_v82('90000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',101,'2026-08-10')$$,'23505',null,'operation id payload conflict rejected');

select results_eq($$select transaction_type from create_investment_v82('90000000-0000-4000-8000-000000000010','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',200,'2026-08-11','Investimentos')$$,$$values ('investimento'::text)$$,'valid investment is created');
select throws_ok($$select create_investment_v82('90000000-0000-4000-8000-000000000011','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','ffffffff-ffff-4fff-8fff-fffffffffff1',10,'2026-08-11','Investimentos')$$,'42501',null,'cross-user investment rejected');
select results_eq($$select transaction_type from create_rescue_v82('90000000-0000-4000-8000-000000000020','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',50,'2026-08-12')$$,$$values ('resgate'::text)$$,'valid rescue is created');
select throws_ok($$select create_rescue_v82('90000000-0000-4000-8000-000000000021','ffffffff-ffff-4fff-8fff-fffffffffff1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',10,'2026-08-12')$$,'42501',null,'cross-user rescue rejected');
select results_eq($$select statement_balance from accounts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,$$values (1000::numeric)$$,'ledger RPCs do not mutate manual account snapshots');
select results_eq($$select current_value from assets where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'$$,$$values (500::numeric)$$,'ledger RPCs do not mutate manual asset snapshots');

select results_eq($$select transaction_type from reverse_structured_operation_v82('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000012','2026-08-13')$$,$$values ('resgate'::text)$$,'investment reversal is a rescue');
select results_eq($$select count(*) from transactions r join transactions o on o.id=r.reversal_of_id where r.operation_id='90000000-0000-4000-8000-000000000012' and o.operation_id='90000000-0000-4000-8000-000000000010'$$,'values (1::bigint)','reversal references original operation');
select throws_ok($$select reverse_structured_operation_v82('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000013','2026-08-13')$$,'23505',null,'second reversal is rejected');
select lives_ok($$select reverse_structured_operation_v82('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000012','2026-08-13')$$,'same reversal request is idempotent');
select results_eq($$select count(*) from transactions where reversal_of_id is not null$$,'values (1::bigint)','only one reversal row exists');
select results_eq($$select transaction_type from reverse_structured_operation_v82('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000004','2026-08-13')$$,$$values ('transferencia'::text)$$,'transfer reversal remains a transfer');
select results_eq($$select count(*) from transactions where operation_id='90000000-0000-4000-8000-000000000004' and source_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' and destination_account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,'values (1::bigint)','transfer reversal swaps source and destination');
select results_eq($$select transaction_type from reverse_structured_operation_v82('90000000-0000-4000-8000-000000000020','90000000-0000-4000-8000-000000000022','2026-08-13','Investimentos')$$,$$values ('investimento'::text)$$,'rescue reversal is an investment with explicit category');
select results_eq($$select category from transactions where operation_id='90000000-0000-4000-8000-000000000022'$$,$$values ('Investimentos'::text)$$,'rescue reversal preserves explicit investment category');

select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,recurring_series_id,recurring_occurrence_date) values('11111111-1111-4111-8111-111111111111','2026-09-01','recurrence first',10,'despesa','programado','33333333-3333-4333-8333-333333330301','2026-09-01')$$,'first recurring occurrence accepted');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,recurring_series_id,recurring_occurrence_date) values('11111111-1111-4111-8111-111111111111','2026-09-01','recurrence duplicate',10,'despesa','programado','33333333-3333-4333-8333-333333330301','2026-09-01')$$,'23505',null,'duplicate recurring occurrence rejected');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,installment_series_id,installment_number) values('11111111-1111-4111-8111-111111111111','2026-10-01','installment first',10,'despesa','programado','80000000-0000-4000-8000-000000000001',1)$$,'first installment accepted');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,installment_series_id,installment_number) values('11111111-1111-4111-8111-111111111111','2026-10-01','installment duplicate',10,'despesa','programado','80000000-0000-4000-8000-000000000001',1)$$,'23505',null,'duplicate installment rejected');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','zero',0,'despesa','realizado')$$,'23514',null,'new zero amount rejected while constraint remains NOT VALID');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','realized status',1,'despesa','realizado')$$,'realizado accepted');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','scheduled status',1,'despesa','programado')$$,'programado accepted');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','cancelled status',1,'despesa','cancelado')$$,'cancelado accepted');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2046-01-01','future realized',1,'receita','realizado')$$,'future_realized remains structurally representable');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','unclassified legacy',1,'despesa',null)$$,'null unclassified legacy remains compatible');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','unknown status',1,'despesa','misterioso')$$,'23514',null,'unknown noncanonical status rejected');
select lives_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status) values('11111111-1111-4111-8111-111111111111','2026-08-01','legacy nullable links',1,'despesa','realizado')$$,'legacy rows may keep new structural links null');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,liability_id) values('11111111-1111-4111-8111-111111111111','2026-08-01','cross liability',1,'despesa','realizado','22222222-2222-4222-8222-222222220201')$$,'23503',null,'cross-user liability reference rejected');
select throws_ok($$insert into transactions(user_id,transaction_date,description,amount,transaction_type,status,source_account_id,destination_account_id) values('11111111-1111-4111-8111-111111111111','2026-08-01','invalid transfer',1,'transferencia','realizado','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,'23514',null,'direct same-account transfer rejected');
select ok(not has_function_privilege('anon','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute'),'anon cannot execute structured RPC');
select ok(has_function_privilege('authenticated','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute'),'authenticated can execute structured RPC');
select ok(not (select prosecdef from pg_proc where oid='public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)'::regprocedure),'structured RPC is security invoker');
select ok(not (select convalidated from pg_constraint where conname='transactions_amount_positive_v82'),'positive amount constraint preserves unvalidated legacy rows');

select * from finish();
rollback;
