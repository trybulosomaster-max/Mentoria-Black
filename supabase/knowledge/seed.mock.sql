-- Synthetic-only fixture for a disposable local database.
-- This file must never contain the commercial book content.
begin;

insert into public.knowledge_publications(
  id,slug,title,subtitle,description,author,publication_type,status,version,
  required_product_code,published_at
) values (
  '81000000-0000-4000-8000-000000000001','mentoria-black-mock','Mentoria Black',
  'Publicação de demonstração','Conteúdo sintético para validar a Área de Conhecimento V1.',
  'Mentoria Black','book','published','mock-1','KNOWLEDGE',clock_timestamp()
) on conflict(id) do update set updated_at=clock_timestamp();

insert into public.knowledge_parts(id,publication_id,position,title) values
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',1,'PARTE 1 — MOCK'),
  ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001',2,'PARTE 2 — MOCK')
on conflict(id) do update set title=excluded.title,updated_at=clock_timestamp();

insert into public.knowledge_chapters(
  id,publication_id,part_id,slug,position,title,subtitle,excerpt,access_level,
  estimated_read_minutes,active
) values
  ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','introducao-mock',1,'Introdução MOCK','Amostra sintética','Trecho de demonstração sem conteúdo comercial real.','sample',2,true),
  ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','capitulo-protegido-mock-1',2,'Capítulo protegido MOCK','Disponível com KNOWLEDGE','Estrutura visível; corpo protegido pelo banco.','knowledge',3,true),
  ('83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','capitulo-protegido-mock-2',1,'Capítulo protegido MOCK — Parte 2','Demonstração de múltiplas partes','Outro capítulo sintético protegido.','knowledge',2,true)
on conflict(id) do update set title=excluded.title,updated_at=clock_timestamp();

insert into public.knowledge_sections(id,chapter_id,position,section_type,content,access_level) values
  ('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',1,'heading','{"text":"Introdução MOCK"}','sample'),
  ('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001',2,'paragraph','{"text":"Este texto é exclusivamente sintético e valida a experiência de leitura da amostra."}','sample'),
  ('84000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001',3,'highlight','{"text":"Amostra pública: nenhum conteúdo definitivo do livro está neste repositório."}','sample'),
  ('84000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000002',1,'heading','{"text":"Capítulo protegido MOCK"}','knowledge'),
  ('84000000-0000-4000-8000-000000000005','83000000-0000-4000-8000-000000000002',2,'paragraph','{"text":"Conteúdo sintético protegido para teste de entitlement e RLS."}','knowledge'),
  ('84000000-0000-4000-8000-000000000006','83000000-0000-4000-8000-000000000002',3,'exercise','{"prompt":"Exercício MOCK","steps":["Passo sintético um","Passo sintético dois"]}','knowledge'),
  ('84000000-0000-4000-8000-000000000007','83000000-0000-4000-8000-000000000003',1,'quote','{"text":"Citação MOCK para validar o renderer estruturado."}','knowledge'),
  ('84000000-0000-4000-8000-000000000008','83000000-0000-4000-8000-000000000003',2,'list','{"items":["Item sintético A","Item sintético B"]}','knowledge'),
  ('84000000-0000-4000-8000-000000000009','83000000-0000-4000-8000-000000000003',3,'separator','{}','knowledge')
on conflict(id) do update set content=excluded.content,updated_at=clock_timestamp();

commit;
