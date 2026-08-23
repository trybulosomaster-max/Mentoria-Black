# Mentoria Black — gate final Commercial Access + Knowledge Area

Status: **GO técnico para uma promoção controlada futura**. Este documento não
autoriza nem executa migration, importação, enforcement, merge ou deploy.

## Identidade e pacote imutável

- Produção Supabase: `mwjqfzbpjmwiscvtxvfc` (`sa-east-1`, saudável), somente leitura neste gate.
- Beta homologada: `amzgqfvyjaiaoohnbcfl` (`sa-east-1`).
- HEAD homologado recebido: `b9d58109086f3eafa98a38f31bb709f13ff058ef`.
- Commit de hardening das migrations e do clone fiel: `77b95c459f6f907329f10f997826db9156221996`.
- Versão protegida do conteúdo: `parts-1-4-v2`.
- Canonical hash: `9c9d90e12ea90f36ea85da291091ab9bb49b76590d9638c856f936dd41a670ad`.
- Source hash preservado fora do Git: `92e9b55f22dc6ae132ade8965242dc2d34e69a0b956339b22e1b4d5e2dc9f069`.
- Conteúdo integral, snapshots, PDF e JSON canônico permanecem fora do Git.

Migrations do pacote, na ordem:

1. `20260822212119_commercial_access_v1.sql`  
   SHA-256 `e9acee521d8a4daf8eacf20829598055927fccbf4df1dec822b95efeba0fe0e0`
2. `20260823000450_knowledge_area_v1.sql`  
   SHA-256 `091b6748d1ba8f87cd5106c22230b5a5f8ba257a92427ba4e798f68100175b2e`
3. `20260823012822_extend_knowledge_editorial_contract_v1.sql`  
   SHA-256 `b1aa17cb3405d6a7c297599d36539ad68a77d023d0d0aca1175b60c8820d4627`

As migrations Beta-only `20260823022320` e `20260823023324` estão
**expressamente fora** do pacote. A primeira seria nominalmente no-op na produção
canônica; a segunda executaria `ALTER POLICY` desnecessário nas nove tabelas. A
produção já possui exatamente `mb_v82_own_rows`, portanto excluí-las evita lock e
DDL sem benefício.

## Snapshot somente leitura

O snapshot protegido foi capturado localmente sem dados pessoais, payloads ou
identificadores externos. Estado observado:

| Objeto | Produção | Beta homologada | Ação futura | Risco/gate |
|---|---|---|---|---|
| Financeiro V82 | 9 policies canônicas; RLS ativo | mesmo contrato | nenhuma reconciliação RLS | parar se houver drift |
| `products` | 1 produto legado | catálogo V2 com 3 produtos | evoluir in-place | preservar UUID/slug/row |
| `access_grants` | 1 grant manual ativo | V2 reconciliado | enriquecer in-place | preservar histórico |
| `payment_events` | 2 eventos Kiwify | V2 multiprovider | enriquecer in-place | preservar payload histórico |
| Kiwify | 2 funções legadas | preservado | manter compatibilidade | não remover Vault RPC |
| Knowledge | objetos ausentes | 1/4/26/1469 | criar schema e importar | RLS antes do conteúdo |
| Conteúdo | ausente | 67 sample / 1.402 knowledge | import server-side | hash/contagens exatos |
| Enforcement APP | não instalado | estado `false` | manter desligado | fase separada |

Contagens de referência do snapshot: 3 usuários Auth; 169 transactions; 14
recurring; 4 goals; 1 account; 1 card; 0 assets; 0 liabilities; 1 product; 1 grant;
2 payment events. Essas contagens são gates de preservação, não fixtures de escrita.

Histórico V82 de produção confirmado até `20260821205630`; nenhuma migration
Commercial/Knowledge estava registrada. Security Advisor de produção: zero achados.

## Compatibilidade e lints aceitos

- O preflight classifica a produção como `KIWIFY_LEGACY_GO` e valida nullability,
  defaults, quatro constraints de `payment_events`, FK `user_id` com `ON DELETE SET
  NULL`, policies, funções, grants e zero execução cliente da RPC de segredo.
- Produto, grant manual, dois eventos, payloads Kiwify e
  `set_kiwify_webhook_token(text)` são preservados. O `UNIQUE (user_id,product_id)`
  é substituído apenas após o preflight exato, permitindo histórico trial + paid.
- As seis tabelas server-only sem policy são deny-by-default; `anon` e
  `authenticated` não recebem writer direto. Classificação: **ACCEPTED**.
- `start_my_app_trial()` é `SECURITY DEFINER`, sem argumentos, usa `auth.uid()`,
  exige e-mail confirmado, tempo server-side, unicidade/lock e `search_path =
  pg_catalog`. Não permite escolher usuário ou expiração. Classificação: **ACCEPTED**.
- `search_path = pg_catalog` e RPC de trial sem argumentos reduzem a superfície de
  ataque; não ampliam acesso. Classificação: **ACCEPTED**.
- Leaked Password Protection está habilitada na produção e o Advisor está limpo.
  O aviso equivalente da Beta é pré-existente e não integra este gate.

## Ordem autorizável em uma etapa futura

1. confirmar backup físico e novo snapshot/preflight read-only;
2. comparar SHAs, hashes e contagens deste manifesto;
3. aplicar somente a migration Commercial em transação;
4. validar 1 produto/1 grant/2 eventos legados preservados, funções Kiwify e
   `commercial_enforcement_state.enforced = false`;
5. validar explicitamente cobertura APP dos proprietários legados autorizados, sem
   ativar enforcement;
6. aplicar a migration Knowledge em transação;
7. aplicar a extensão editorial em transação;
8. validar RLS, grants, RPCs e Advisors antes do conteúdo;
9. importar `parts-1-4-v2` server-side e idempotentemente;
10. validar 1/4/26/1469, 67/1.402, canonical hash e source hashes;
11. testar anon, APP, KNOWLEDGE, COMPLETE, revoked, FTS sem vazamento,
    progress/bookmarks e cross-user;
12. executar regressão financeira focal e teste de rollback seletivo;
13. somente depois preparar/deployar o frontend em etapa separada;
14. ativar enforcement financeiro apenas em autorização e janela próprias.

Parar imediatamente em checksum, schema, policy, função, contagem, hash, acesso,
Advisor de segurança ou preservação Kiwify divergente. Não usar `db push` genérico,
baseline, backfill por inferência ou conteúdo público.

## Rollback por camada

- **Commercial:** application-first. Como enforcement permanece desligado, não há
  bloqueio financeiro no deploy estrutural. Revogar writers novos se necessário e
  preservar tabelas, grants, eventos e payloads históricos. Não fazer `DROP`.
- **Knowledge/content:** verificar identidade e contagens exatas; remover somente a
  publicação `parts-1-4-v2`, deixando o cascade restrito a parts/chapters/sections e
  progress/bookmarks associados. O schema pode permanecer inativo.
- **Editorial:** manter o contrato superset; não rebaixar validadores em banco com
  conteúdo. O retry da cadeia completa foi testado.
- **Frontend:** revert/deploy application-first para o artefato anterior; o banco
  aditivo permanece compatível.
- **Enforcement:** é uma fase independente e fica desligado neste pacote.
- **Backup físico:** usar somente para corrupção/perda comprovada e com nova
  autorização explícita.

Não existe ponto de não retorno antes de novos eventos/progressos reais. Depois
disso, rollback destrutivo de schema fica proibido; permanece apenas rollback
application-first e reconciliação preservando histórico.

## Evidência local

O clone fiel reproduziu o legado real (1 produto, 1 grant manual, 2 eventos Kiwify),
aplicou Commercial → Knowledge → Editorial → conteúdo, preservou todas as rows e
payloads e chegou a 1/4/26/1469, 67/1.402. Retry completo, falha transacional, drift
incompatível, rollback seletivo e reimport foram aprovados. RLS, FTS, progress,
bookmarks, Kiwify writer compatível, Commercial Access e adapters Asaas sintéticos
também passaram. Nenhuma rede Asaas, produção escrita, merge ou deploy foi usado.

Backup observado: físico de `2026-08-22 06:13:54 UTC`, Restore disponível, retenção
Pro de 7 dias. Nenhuma restauração foi executada.
