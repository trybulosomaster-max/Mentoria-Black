# Mentoria Black — Knowledge Area V1

Status: implementação exclusivamente local em `feature/knowledge-area-v1`. Não aplicada ao Supabase remoto e não publicada.

## Princípios

- Uma conta e uma sessão Supabase atendem APP e KNOWLEDGE.
- O servidor decide autorização por `has_active_access('KNOWLEDGE')`; o navegador apenas apresenta o resultado.
- Metadados editoriais seguros (biblioteca, partes, títulos, excerpts) podem formar o catálogo. O corpo `knowledge` nunca é devolvido sem entitlement.
- Trial APP e APP pago acessam somente `public`/`sample`. KNOWLEDGE, COMPLETE e manual KNOWLEDGE acessam o conteúdo integral.
- Progresso e favoritos não concedem acesso e pertencem sempre ao próprio `auth.uid()`.
- O conteúdo comercial integral não pertence ao Git, ao bundle, ao GitHub Pages ou a JSON público.

## Modelo

| Tabela | Responsabilidade | Chaves/índices principais |
|---|---|---|
| `knowledge_publications` | Livros, cursos, materiais e coleções | `slug` único; FK do produto exigido |
| `knowledge_parts` | Agrupamento editorial ordenado | `(publication_id, position)` |
| `knowledge_chapters` | Sumário, excerpt e nível de acesso | `(publication_id, slug)`, `(part_id, position)` |
| `knowledge_sections` | Conteúdo estruturado protegido | `(chapter_id, position)`, GIN de busca |
| `knowledge_progress` | Retomada e conclusão por usuário/capítulo | PK `(user_id, chapter_id)`; índice usuário/publicação |
| `knowledge_bookmarks` | Favorito de capítulo ou seção | alvo único por usuário; índice por usuário/data |

Hierarquia: Biblioteca → Publicação → Parte → Capítulo → Seções. A estrutura aceita múltiplas publicações e tipos editoriais sem criar tabelas específicas para um único livro.

## Conteúdo estruturado

`knowledge_sections.content` é JSONB validado por tipo. Tipos permitidos:

- `paragraph`, `heading`, `subheading`, `quote`, `highlight`, `warning`, `rule_black`, `impact_phrase`, `transition`, `callout` — campo `text`;
- `list`, `checklist`, `chapter_checklist` — `items[]`;
- `table` — `columns[]` e `rows[][]`;
- `exercise`, `exercise_black`, `example` — `prompt` e `steps[]` opcional;
- `image` — caminho relativo seguro e texto alternativo;
- `separator` — objeto vazio.

HTML arbitrário, URLs externas em imagens, travessia de diretório e metadata fora da lista aprovada são rejeitados. O renderer usa escape de texto; ele não usa `innerHTML` vindo do banco.

## RLS e grants

Níveis:

- `public`: elegível a conteúdo público;
- `sample`: degustação sem KNOWLEDGE;
- `knowledge`: exige `has_active_access('KNOWLEDGE')`.

As tabelas editoriais concedem somente `SELECT` a `anon`/`authenticated`. As policies devolvem seções `public`/`sample` mesmo dentro de um capítulo protegido — necessário para aberturas editoriais — sem devolver as demais seções `knowledge`. O corpo integral exige entitlement. O predicado KNOWLEDGE é um subselect não correlacionado e pode ser resolvido uma vez por statement, em vez de executar por parágrafo.

`knowledge_progress` e `knowledge_bookmarks` concedem CRUD somente a `authenticated`, com `auth.uid()` no `USING`/`WITH CHECK`. As RPCs `save_my_knowledge_progress_v1` e `set_my_knowledge_bookmark_v1` não recebem `user_id`. Busca usa `search_my_knowledge_v1`; como a função é `SECURITY INVOKER`, o índice GIN e a RLS filtram os resultados antes do snippet.

Matriz esperada:

| Perfil | Catálogo | Sample | Corpo knowledge | Progresso/favoritos |
|---|---:|---:|---:|---:|
| anon | sim | sim | não | não |
| trial APP | sim | sim | não | próprio sample |
| APP pago | sim | sim | não | próprio sample |
| KNOWLEDGE | sim | sim | sim | próprio |
| COMPLETE | sim | sim | sim | próprio |
| KNOWLEDGE revogado | sim | sim | não | preservado, sem vazamento |

## Frontend

`knowledge/knowledge-area.js` contém biblioteca, sumário, reader, favoritos, busca e paywall. A tela é montada pelos entitlements resolvidos no bootstrap comercial existente:

- APP + KNOWLEDGE: navegação financeira e biblioteca integral;
- KNOWLEDGE-only: paywall do APP e biblioteca integral na mesma sessão;
- APP/trial sem KNOWLEDGE: biblioteca e amostra, com CTA mockado;
- sem grants: oferta e amostra.

Um capítulo protegido pode consultar suas seções para exibir uma abertura `sample`; a RLS devolve somente essa amostra e impede que qualquer seção `knowledge` chegue ao navegador. Sem amostra autorizada, o reader mostra diretamente o paywall.

## Progresso, favoritos e busca

- Abrir capítulo registra retomada mínima server-side.
- “Marcar como concluído” grava 100%, última seção e `completed_at`.
- Favoritar é idempotente por usuário/capítulo/seção.
- Busca usa FTS em português e retorna apenas título/snippet autorizado pelo mesmo RLS.
- Progresso e favoritos sobrevivem a expiração/revogação; não influenciam entitlement.

## Importação futura do livro real

O contrato versionado está em `knowledge/import-contract.js`. O fixture `knowledge/fixtures/mentoria-black.mock.json` é exclusivamente sintético.

Validação local:

```sh
node scripts/validate-knowledge-import.js /caminho/seguro/publicacao.json
```

Fluxo futuro recomendado:

1. manter o arquivo real fora do repositório e com acesso administrativo restrito;
2. validar slugs, posições, níveis, tipos, campos vazios e referências com o script;
3. converter Markdown apenas para o JSON estruturado permitido, sem HTML livre;
4. importar server-side com credencial administrativa de sessão, em transação;
5. confirmar contagens e amostras por consultas sem conteúdo sensível;
6. testar anon, APP-only, KNOWLEDGE e cross-user;
7. apagar artefatos temporários após confirmação e registrar apenas checksum/contagens.

O conversor e o emissor SQL local estão documentados em `KNOWLEDGE_PARTS_1_4_INGESTION.md`. O emissor restringe a execução a clones descartáveis cujo nome siga o prefixo técnico aprovado; ele não contém nem publica o livro comercial.

## Migration e recuperação

Migration local: `supabase/migrations/20260823000450_knowledge_area_v1.sql`.

Extensão editorial local: `supabase/migrations/20260823012822_extend_knowledge_editorial_contract_v1.sql`.

SHA-256 da migration base: `091b6748d1ba8f87cd5106c22230b5a5f8ba257a92427ba4e798f68100175b2e`.

SHA-256 da extensão editorial: `b1aa17cb3405d6a7c297599d36539ad68a77d023d0d0aca1175b60c8820d4627`.

Características:

- transação integral e advisory lock;
- pré-condição explícita do Commercial Access V2;
- recusa schema parcial, colunas incompatíveis, RPC insegura e policy permissiva;
- retry sem recriar dados;
- retry da cadeia completa não rebaixa os validadores editoriais quando a migration
  base é reapresentada depois da extensão;
- constraints compostas preservam capítulo/publicação e seção/capítulo;
- falha parcial volta toda a transação.

Rollback operacional antes de conteúdo real: retirar a navegação/reader da aplicação e revogar as RPCs do cliente. A remoção física das tabelas não é automática porque apagaria progresso/conteúdo; qualquer remoção exige nova migration autorizada e backup. Em falha durante a migration, o próprio `ROLLBACK` deixa o estado anterior intacto.

## Testes locais

```sh
node tests/knowledge-area-v1.test.js
supabase/tests/knowledge_area_v1_test.sh
```

O harness cria bancos descartáveis, aplica Commercial Access + Knowledge, insere apenas mocks e cobre RLS, busca, progresso, favoritos, entitlement revogado, retry, rollback parcial e drift incompatível. Não há acesso remoto.

## Decisões pendentes

- capa e conteúdo editorial definitivos;
- ferramenta administrativa de importação e revisão;
- política editorial de versionamento e arquivamento;
- escopo de busca entre múltiplas publicações;
- armazenamento privado e transformação de imagens comerciais;
- experiência visual final após integração deliberada da branch de branding.
