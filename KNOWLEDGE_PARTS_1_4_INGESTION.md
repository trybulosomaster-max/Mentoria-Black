# Mentoria Black — ingestão protegida das Partes 1–4

Status: conversão e importação validadas exclusivamente em clone local descartável. Nenhum conteúdo foi enviado ao Supabase remoto ou incorporado ao bundle público.

## Fonte e proteção

- Fonte canônica local: `.local-content/mentoria-black-partes-1-a-4.pdf`.
- PDF, texto extraído, JSON estruturado e SQL de importação permanecem sob `.local-content/` ou diretório temporário do sistema.
- `.local-content/` está no `.gitignore`.
- O scanner `scripts/check-knowledge-content-leak.js` compara shingles de 12 palavras e falha se encontrar texto comercial longo em qualquer arquivo versionado ou versionável.
- Logs e relatórios registram somente contagens, títulos, hashes, páginas-fonte e termos editoriais curtos.

Hashes desta conversão:

| Artefato | SHA-256 |
|---|---|
| PDF canônico | `92e9b55f22dc6ae132ade8965242dc2d34e69a0b956339b22e1b4d5e2dc9f069` |
| Texto extraído protegido | `2a1b8b776361c723f42c3c7f822b9e1961dbd66c33a6ad24d8f928805514d0bc` |
| Documento estruturado protegido | `3b000845e0a1d7dd77f50925bebe0b340238142b834b4eb476896137dffb9900` |
| Migration editorial | `b1aa17cb3405d6a7c297599d36539ad68a77d023d0d0aca1175b60c8820d4627` |

## Contrato reconhecido

- 4 partes;
- 26 capítulos, numerados de 1 a 26;
- 1.469 seções estruturadas;
- 26 Regras Black;
- 28 exercícios, dos quais 8 são Exercícios Black;
- 26 checklists de capítulo;
- 26 Frases de Impacto;
- 8 tabelas;
- 3 blocos de conclusão;
- 6 transições.

Metadados de componentes futuros foram marcados sem redesign: Sistema Black 6, Camadas de Segurança, evolução financeira, comparação de cenários e exercícios finais.

## Política de acesso

- Abertura da Parte 1 e Capítulo 1: `sample`.
- Capítulos 2–8: `knowledge`.
- Abertura da Parte 2: `sample`; capítulos 9–14: `knowledge`.
- Partes 3–4: títulos/excerpts no catálogo e corpos `knowledge`.
- Busca usa a mesma RLS de `knowledge_sections`; snippets nunca contornam o entitlement.
- APP trial e APP paid veem somente a amostra. KNOWLEDGE e COMPLETE veem o conteúdo integral.

## Processo local

Conversão protegida:

```sh
node scripts/structure-knowledge-book.js \
  --source-text .local-content/mentoria-black-partes-1-a-4.txt \
  --source-pdf .local-content/mentoria-black-partes-1-a-4.pdf \
  --output .local-content/mentoria-black-partes-1-a-4.structured.json \
  --metrics-out knowledge/reports/parts-1-4-metrics.json \
  --editorial-out knowledge/reports/parts-1-4-editorial.md
```

Validação sem escrita e dry-run:

```sh
node scripts/validate-knowledge-import.js --validate-only \
  .local-content/mentoria-black-partes-1-a-4.structured.json
node scripts/validate-knowledge-import.js --dry-run \
  .local-content/mentoria-black-partes-1-a-4.structured.json
```

Clone descartável:

```sh
supabase/tests/knowledge_parts_1_4_ingestion_test.sh
```

O emissor `scripts/prepare-knowledge-import-sql.js` recusa saída versionada e o SQL gerado recusa bancos cujo nome não comece por `mb_knowledge_parts_1_4_`. A importação é transacional, idempotente por identidade determinística e falha em conteúdo existente incompatível.

## Revisão editorial

O relatório `knowledge/reports/parts-1-4-editorial.md` agrega localização e sugestão para nomenclaturas antigas ou inconsistentes. Nenhuma sugestão altera automaticamente o PDF ou o JSON protegido.

## Próxima etapa

1. aprovar ou rejeitar cada apontamento editorial;
2. gerar nova fonte canônica se houver correções;
3. repetir conversão, hashes, validate-only, dry-run e clone local;
4. obter autorização específica antes de criar qualquer ambiente remoto de revisão;
5. importar remotamente somente por procedimento server-side protegido, nunca pelo frontend.
