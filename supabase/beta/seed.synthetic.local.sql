-- LOCAL-ONLY synthetic Beta fixtures. Never use with --linked or on a hosted project.
-- Auth users are direct local fixtures; hosted Beta users must be created through Auth.

insert into auth.users(id,email) values
  ('aaaaaaaa-1111-4111-8111-111111111111','beta-a@example.invalid'),
  ('bbbbbbbb-2222-4222-8222-222222222222','beta-b@example.invalid');

insert into public.accounts(id,user_id,name,opening_balance,statement_balance,balance_as_of) values
  ('aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111111','Conta Beta A',10000,10000,'2026-08-01'),
  ('aaaaaaaa-1111-4111-8111-111111111102','aaaaaaaa-1111-4111-8111-111111111111','Reserva Beta A',2000,2000,'2026-08-01'),
  ('bbbbbbbb-2222-4222-8222-222222222201','bbbbbbbb-2222-4222-8222-222222222222','Conta Beta B',5000,5000,'2026-08-01');

insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('aaaaaaaa-1111-4111-8111-111111111103','aaaaaaaa-1111-4111-8111-111111111111','Cartão Beta A',3000,10,17),
  ('bbbbbbbb-2222-4222-8222-222222222202','bbbbbbbb-2222-4222-8222-222222222222','Cartão Beta B',1500,12,20);

insert into public.assets(id,user_id,name,opening_value,current_value,value_as_of) values
  ('aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111111','Fundo Beta A',3000,3000,'2026-08-01');

insert into public.goals(id,user_id,name,target,current,deadline) values
  ('aaaaaaaa-1111-4111-8111-111111111105','aaaaaaaa-1111-4111-8111-111111111111','Casamento',50000,0,'2031-10-01'),
  ('aaaaaaaa-1111-4111-8111-111111111107','aaaaaaaa-1111-4111-8111-111111111111','Viagem JP',8000,0,'2028-08-01'),
  ('aaaaaaaa-1111-4111-8111-111111111109','aaaaaaaa-1111-4111-8111-111111111111','Viagem sem prazo',8000,0,null);

insert into public.recurring(id,user_id,name,type,amount,category,account_id,source_account_id,asset_id,frequency,"interval",start_date,next_date,active,goal_id,goal_effect) values
  ('aaaaaaaa-1111-4111-8111-111111111106','aaaaaaaa-1111-4111-8111-111111111111','Aporte Casamento','investimento',550,'Metas','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','monthly',1,'2026-09-01','2026-09-01',true,'aaaaaaaa-1111-4111-8111-111111111105','contribution'),
  ('aaaaaaaa-1111-4111-8111-111111111108','aaaaaaaa-1111-4111-8111-111111111111','Aporte Viagem JP','investimento',550,'Metas','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','monthly',1,'2026-09-01','2026-09-01',true,'aaaaaaaa-1111-4111-8111-111111111107','contribution'),
  ('aaaaaaaa-1111-4111-8111-111111111110','aaaaaaaa-1111-4111-8111-111111111111','Aporte Viagem sem prazo','investimento',550,'Metas','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','monthly',1,'2026-09-01','2026-09-01',true,'aaaaaaaa-1111-4111-8111-111111111109','contribution');

insert into public.transactions(id,user_id,transaction_date,description,category,amount,transaction_type,status,account_id,source_account_id,asset_id,goal_id,goal_effect) values
  ('10000000-0000-4000-8000-000000000001','aaaaaaaa-1111-4111-8111-111111111111','2026-08-05','Receita Beta','Salário',8000,'receita','realizado','aaaaaaaa-1111-4111-8111-111111111101',null,null,null,null),
  ('10000000-0000-4000-8000-000000000002','aaaaaaaa-1111-4111-8111-111111111111','2026-08-06','Despesa Beta','Gastos Fixos',1200,'despesa','realizado','aaaaaaaa-1111-4111-8111-111111111101',null,null,null,null),
  ('10000000-0000-4000-8000-000000000003','aaaaaaaa-1111-4111-8111-111111111111','2026-08-12','Investimento Beta','Investimentos',500,'investimento','realizado',null,'aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104',null,null),
  ('10000000-0000-4000-8000-000000000004','aaaaaaaa-1111-4111-8111-111111111111','2026-07-01','Casamento realizado','Metas',550,'investimento','realizado',null,'aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111105','contribution'),
  ('10000000-0000-4000-8000-000000000005','aaaaaaaa-1111-4111-8111-111111111111','2026-08-01','Casamento realizado','Metas',550,'investimento','realizado',null,'aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111105','contribution'),
  ('10000000-0000-4000-8000-000000000006','aaaaaaaa-1111-4111-8111-111111111111','2026-08-01','Viagem realizada','Metas',550,'investimento','realizado',null,'aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111107','contribution'),
  ('20000000-0000-4000-8000-000000000001','bbbbbbbb-2222-4222-8222-222222222222','2026-08-05','Receita isolada B','Salário',4000,'receita','realizado','bbbbbbbb-2222-4222-8222-222222222201',null,null,null,null),
  ('20000000-0000-4000-8000-000000000002','bbbbbbbb-2222-4222-8222-222222222222','2026-08-07','Despesa isolada B','Lazer',300,'despesa','realizado','bbbbbbbb-2222-4222-8222-222222222201',null,null,null,null);

insert into public.transactions(id,user_id,transaction_date,description,category,amount,transaction_type,status,source_account_id,asset_id,goal_id,goal_effect,recurring_series_id,recurring_occurrence_date)
select md5('casamento-'||n)::uuid,'aaaaaaaa-1111-4111-8111-111111111111',(date '2026-09-01'+(n||' month')::interval)::date,'Casamento programado','Metas',550,'investimento','programado','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111105','contribution','aaaaaaaa-1111-4111-8111-111111111106',(date '2026-09-01'+(n||' month')::interval)::date
from generate_series(0,11) n;

insert into public.transactions(id,user_id,transaction_date,description,category,amount,transaction_type,status,source_account_id,asset_id,goal_id,goal_effect,recurring_series_id,recurring_occurrence_date)
select md5('viagem-'||n)::uuid,'aaaaaaaa-1111-4111-8111-111111111111',(date '2026-09-01'+(n||' month')::interval)::date,'Viagem programada','Metas',550,'investimento','programado','aaaaaaaa-1111-4111-8111-111111111101','aaaaaaaa-1111-4111-8111-111111111104','aaaaaaaa-1111-4111-8111-111111111107','contribution','aaaaaaaa-1111-4111-8111-111111111108',(date '2026-09-01'+(n||' month')::interval)::date
from generate_series(0,5) n;
