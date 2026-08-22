begin;
create extension if not exists pgtap;
select no_plan();

select is((select count(*) from public.products where product_kind='entitlement'),2::bigint,'APP and KNOWLEDGE are grantable');
select is((select count(*) from public.product_components pc join public.products p on p.id=pc.bundle_product_id where p.code='COMPLETE'),2::bigint,'COMPLETE expands to independent grants');
select is((select count(*) from public.commercial_offers where active),0::bigint,'offers have no live prices or checkout configuration');
select is((select grace_period_hours from public.commercial_offers where code='APP_MONTHLY'),72,'paid APP grace is configurable at 72 hours');
select is((select knowledge_cancellation_policy from public.commercial_offers where code='COMPLETE_MONTHLY'),'KNOWLEDGE_LIFETIME_AFTER_VALID_ACQUISITION','COMPLETE decision is explicit');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.products'::regclass,'public.product_trials'::regclass,'public.access_grants'::regclass,
  'public.commercial_admin_audit'::regclass,'public.billing_customers'::regclass,
  'public.billing_orders'::regclass,'public.billing_order_grants'::regclass,
  'public.billing_subscriptions'::regclass,'public.payment_events'::regclass
)),'commercial tables have RLS');
select ok(not (select prosecdef from pg_proc where oid='public.get_my_entitlements()'::regprocedure),'resolver is security invoker');
select ok(not (select prosecdef from pg_proc where oid='public.has_active_access(text)'::regprocedure),'access predicate is security invoker');
select ok((select prosecdef from pg_proc where oid='public.start_my_app_trial()'::regprocedure),'trial starter is narrow security definer');
select is((select proconfig[1] from pg_proc where oid='public.start_my_app_trial()'::regprocedure),'search_path=pg_catalog','trial search_path is controlled');
select ok(not has_function_privilege('authenticated','public.admin_grant_commercial_access_v1(uuid,text[],text,timestamptz,uuid,text)','EXECUTE'),'authenticated cannot call admin grant');
select ok(not has_function_privilege('authenticated','public.admin_get_commercial_access_v1(uuid)','EXECUTE'),'authenticated cannot enumerate admin access');
select ok(not has_function_privilege('authenticated','public.process_payment_event_v1(uuid)','EXECUTE'),'authenticated cannot process payment events');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('product_trials','access_grants','commercial_admin_audit','billing_customers','billing_orders','billing_order_grants','billing_subscriptions','payment_events') and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),0::bigint,'clients cannot write commercial ledgers');

insert into auth.users(id,email,email_confirmed_at) values
 ('a0000000-0000-4000-8000-000000000001','a@example.invalid',null),
 ('b0000000-0000-4000-8000-000000000002','b@example.invalid',now()),
 ('c0000000-0000-4000-8000-000000000003','c@example.invalid',now()),
 ('d0000000-0000-4000-8000-000000000004','admin@example.invalid',now()),
 ('e0000000-0000-4000-8000-000000000005','complete@example.invalid',now());

set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select is((select result from public.start_my_app_trial()),'not_eligible','unconfirmed email is not eligible and is not mutated');
reset role;
select is((select count(*) from public.product_trials where user_id='a0000000-0000-4000-8000-000000000001'),0::bigint,'signup alone does not create trial');
update auth.users set email_confirmed_at=clock_timestamp() where id='a0000000-0000-4000-8000-000000000001';

set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select is((select result from public.start_my_app_trial()),'started','first confirmed login starts trial');
select is((select result from public.start_my_app_trial()),'already_active','second start does not restart trial');
select ok(public.has_active_access('APP'),'trial grants APP');
select ok(not public.has_active_access('KNOWLEDGE'),'trial never grants KNOWLEDGE');
select is((public.get_my_entitlements()->'app'->>'access_type'),'trial','resolver exposes trial access type');
select ok((public.get_my_entitlements()->'app'->>'trial_remaining_seconds')::bigint > 604790,'resolver returns server-derived remaining time');
reset role;
select is((select count(*) from public.product_trials where user_id='a0000000-0000-4000-8000-000000000001'),1::bigint,'one trial per user product');
select is((select extract(epoch from(expires_at-started_at))::bigint from public.product_trials where user_id='a0000000-0000-4000-8000-000000000001'),604800::bigint,'trial lasts exactly 168h');

insert into public.accounts(id,user_id,name) values
 ('aa000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','A'),
 ('bb000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','B');
set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.accounts),1::bigint,'APP active reads only own financial data'); reset role;
set local role authenticated; set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.accounts),0::bigint,'no APP cannot load finance');
select throws_ok($$insert into public.access_grants(user_id,product_id,access_type,source_provider) select auth.uid(),id,'paid','asaas' from public.products where code='APP'$$,'42501',null,'client cannot self elevate'); reset role;

update public.product_trials set started_at=statement_timestamp()-interval '167 hours 59 minutes',expires_at=statement_timestamp()+interval '1 minute' where user_id='a0000000-0000-4000-8000-000000000001';
update public.access_grants set starts_at=statement_timestamp()-interval '167 hours 59 minutes',expires_at=statement_timestamp()+interval '1 minute' where user_id='a0000000-0000-4000-8000-000000000001' and access_type='trial';
set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001'; select ok(public.has_active_access('APP'),'trial active at 167h59'); reset role;
update public.product_trials set started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='a0000000-0000-4000-8000-000000000001';
update public.access_grants set starts_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='a0000000-0000-4000-8000-000000000001' and access_type='trial';
set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select ok(not public.has_active_access('APP'),'trial blocks at 168h');
select is((public.get_my_entitlements()->'app'->>'state'),'expired','expired state reaches paywall');
select is((select count(*) from public.accounts),0::bigint,'expired user data remains but is RLS blocked');
select is((select result from public.start_my_app_trial()),'already_used','expired trial cannot restart'); reset role;
select is((select count(*) from public.accounts where user_id='a0000000-0000-4000-8000-000000000001'),1::bigint,'expiration preserves data');

select is((select count(*) from public.bootstrap_commercial_admin_v1('d0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000004','Initial owner bootstrap')),2::bigint,'bootstrap grants APP and KNOWLEDGE');
select is((select count(*) from public.bootstrap_commercial_admin_v1('d0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000004','Initial owner bootstrap') where created),0::bigint,'bootstrap is idempotent');
select is((select count(*) from public.commercial_admin_audit where action='bootstrap'),2::bigint,'bootstrap attempts are audit logged');
select is((public.admin_get_commercial_access_v1('d0000000-0000-4000-8000-000000000004')->>'target_exists')::boolean,true,'backend admin can resolve a user by UUID');
select is(jsonb_array_length(public.admin_get_commercial_access_v1('d0000000-0000-4000-8000-000000000004')->'grants'),2,'backend admin lists grants without exposing Auth profile data');
set local role authenticated; set local request.jwt.claim.sub='d0000000-0000-4000-8000-000000000004';
select ok(public.has_active_access('APP') and public.has_active_access('KNOWLEDGE'),'administrator bootstrap protects owner access'); reset role;

insert into public.billing_orders(id,user_id,offer_id,provider,environment,status,external_payment_id,external_subscription_id,paid_through)
select '10000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',id,'asaas','sandbox','pending','pay-app','sub-app',clock_timestamp()+interval '30 days' from public.commercial_offers where code='APP_MONTHLY';
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id)
values ('20000000-0000-4000-8000-000000000001','asaas','sandbox','evt-confirm','PAYMENT_CONFIRMED',repeat('a',64),'pay-app');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000001'),'processed','confirmed payment processes');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000001'),'processed','processed event retry is no-op');
select is((select count(*) from public.billing_order_grants where order_id='10000000-0000-4000-8000-000000000001'),1::bigint,'event creates one APP grant once');
set local role authenticated; set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002'; select ok(public.has_active_access('APP'),'paid APP grants finance'); reset role;
update public.billing_orders set paid_through=clock_timestamp()+interval '60 days' where id='10000000-0000-4000-8000-000000000001';
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_subscription_id) values ('20000000-0000-4000-8000-000000000008','asaas','sandbox','evt-renewal','PAYMENT_RECEIVED',repeat('8',64),'sub-app');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000008'),'processed','renewal processes idempotently');
select ok((select g.expires_at>clock_timestamp()+interval '59 days' from public.access_grants g join public.billing_order_grants bog on bog.grant_id=g.id where bog.order_id='10000000-0000-4000-8000-000000000001'),'renewal advances APP paid period');

insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000002','asaas','sandbox','evt-overdue','PAYMENT_OVERDUE',repeat('b',64),'pay-app');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000002'),'processed','overdue enters configured grace');
select is((select extract(epoch from(g.grace_until-o.paid_through))::int from public.access_grants g join public.billing_order_grants bog on bog.grant_id=g.id join public.billing_orders o on o.id=bog.order_id where o.id='10000000-0000-4000-8000-000000000001'),259200,'grace lasts 3 days');
set local role authenticated; set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002'; select ok(public.has_active_access('APP'),'APP remains active during grace'); reset role;
update public.access_grants set grace_until=statement_timestamp() where id=(select grant_id from public.billing_order_grants where order_id='10000000-0000-4000-8000-000000000001');
set local role authenticated; set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002'; select ok(not public.has_active_access('APP'),'APP blocks at grace end'); reset role;

insert into public.billing_orders(id,user_id,offer_id,provider,environment,status,external_payment_id,external_subscription_id,paid_through)
select '10000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000005',id,'asaas','sandbox','pending','pay-complete','sub-complete',clock_timestamp()+interval '30 days' from public.commercial_offers where code='COMPLETE_MONTHLY';
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000003','asaas','sandbox','evt-complete','PAYMENT_RECEIVED',repeat('c',64),'pay-complete');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000003'),'processed','COMPLETE payment processes');
select is((select count(*) from public.billing_order_grants where order_id='10000000-0000-4000-8000-000000000002'),2::bigint,'COMPLETE creates two linked grants');
select is((select access_type from public.access_grants g join public.billing_order_grants bog on bog.grant_id=g.id join public.products p on p.id=g.product_id where bog.order_id='10000000-0000-4000-8000-000000000002' and p.code='KNOWLEDGE'),'lifetime','COMPLETE knowledge is lifetime');
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_subscription_id) values ('20000000-0000-4000-8000-000000000004','asaas','sandbox','evt-cancel','SUBSCRIPTION_DELETED',repeat('d',64),'sub-complete');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000004'),'processed','normal cancellation is processed');
set local role authenticated; set local request.jwt.claim.sub='e0000000-0000-4000-8000-000000000005'; select ok(public.has_active_access('APP') and public.has_active_access('KNOWLEDGE'),'cancellation keeps paid period and lifetime knowledge'); reset role;

insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000005','asaas','sandbox','evt-partial','PAYMENT_PARTIALLY_REFUNDED',repeat('e',64),'pay-complete');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000005'),'administrative_review','partial refund never auto-revokes');
select is((select count(*) from public.access_grants g join public.billing_order_grants bog on bog.grant_id=g.id where bog.order_id='10000000-0000-4000-8000-000000000002' and g.status='active'),2::bigint,'partial refund preserves grants for review');
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000006','asaas','sandbox','evt-refund','PAYMENT_REFUNDED',repeat('f',64),'pay-complete');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000006'),'processed','full refund processes');
select is((select count(*) from public.access_grants g join public.billing_order_grants bog on bog.grant_id=g.id where bog.order_id='10000000-0000-4000-8000-000000000002' and g.status='refunded'),2::bigint,'full refund revokes both related grants');

insert into public.billing_orders(id,user_id,offer_id,provider,environment,status,external_payment_id)
select '10000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',id,'asaas','sandbox','pending','pay-knowledge' from public.commercial_offers where code='KNOWLEDGE_LIFETIME';
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000009','asaas','sandbox','evt-knowledge','PAYMENT_RECEIVED',repeat('9',64),'pay-knowledge');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000009'),'processed','KNOWLEDGE purchase processes');
set local role authenticated; set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003'; select ok(public.has_active_access('KNOWLEDGE') and not public.has_active_access('APP'),'KNOWLEDGE-only does not unlock finance'); reset role;
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000010','asaas','sandbox','evt-chargeback','PAYMENT_CHARGEBACK_REQUESTED',repeat('0',64),'pay-knowledge');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000010'),'processed','chargeback processes');
set local role authenticated; set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003'; select ok(not public.has_active_access('KNOWLEDGE'),'chargeback revokes linked knowledge'); reset role;
select is((select count(*) from public.admin_grant_commercial_access_v1('c0000000-0000-4000-8000-000000000003',array['APP'],'manual',clock_timestamp()+interval '1 day','d0000000-0000-4000-8000-000000000004','Temporary support access') where created),1::bigint,'admin can grant temporary APP');
set local role authenticated; set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003'; select ok(public.has_active_access('APP'),'manual APP unlocks own finance'); reset role;
select ok(public.admin_revoke_commercial_access_v1((select g.id from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='c0000000-0000-4000-8000-000000000003' and p.code='APP' and g.source_provider='manual'),'d0000000-0000-4000-8000-000000000004','Temporary support complete'),'admin can revoke with audit');
select is((select count(*) from public.admin_grant_commercial_access_v1('c0000000-0000-4000-8000-000000000003',array['APP'],'manual',(select expires_at from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='c0000000-0000-4000-8000-000000000003' and p.code='APP' and g.source_provider='manual'),'d0000000-0000-4000-8000-000000000004','Temporary support restored') where created),1::bigint,'revoked admin grant can be restored idempotently');

insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id) values ('20000000-0000-4000-8000-000000000007','asaas','sandbox','evt-orphan','PAYMENT_RECEIVED',repeat('1',64),'missing');
select is(public.process_payment_event_v1('20000000-0000-4000-8000-000000000007'),'retryable','unmatched event remains retryable');
select ok((select status='failed' and next_retry_at is not null and processing_attempts=1 from public.payment_events where id='20000000-0000-4000-8000-000000000007'),'failed processing remains reconciliable');

select is((select count(*) from pg_policies where schemaname='public' and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans') and policyname='mb_commercial_app_access'),9::bigint,'nine financial tables are entitlement gated');
set local role anon; select throws_ok($$select public.get_my_entitlements()$$,'42501',null,'anon cannot resolve'); reset role;

select * from finish();
rollback;
