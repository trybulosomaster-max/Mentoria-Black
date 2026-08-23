# Mentoria Black — gate final Commercial Access + Knowledge Area

Status: **gate novamente elegível após homologação do comprador novo na Beta**.
O reader de token legado e o gerador de senha temporária limitado a 64 bytes foram
validados no entrypoint real. Este documento não autoriza nem executa migration,
importação, enforcement, merge ou deploy. A produção permaneceu inalterada.

## Identidade e pacote imutável

- Produção Supabase: `mwjqfzbpjmwiscvtxvfc` (`sa-east-1`, saudável), somente leitura neste gate.
- Beta homologada: `amzgqfvyjaiaoohnbcfl` (`sa-east-1`).
- HEAD funcional candidato: `3f61612b952734772d377bfb1b4ceb81ec0962ca`.
- Edge Function candidata: `kiwify-webhook` Beta v15, bundle SHA-256
  `df68b86291ece198236fb1a2d352cae4b9731bb3a8fe132c0850ae8861a06396`.
- Edge Function atual de produção: `kiwify-webhook` v4, bundle/source SHA-256
  `4e05db916526212b9b22bf9b2d44794e86d3008f9d23fb54f8a336b3c083c301`.
- Versão protegida do conteúdo: `parts-1-4-v2`.
- Canonical hash: `9c9d90e12ea90f36ea85da291091ab9bb49b76590d9638c856f936dd41a670ad`.
- Source hash preservado fora do Git: `92e9b55f22dc6ae132ade8965242dc2d34e69a0b956339b22e1b4d5e2dc9f069`.
- Conteúdo integral, snapshots, PDF e JSON canônico permanecem fora do Git.

Migrations do pacote, na ordem:

1. `20260822212119_commercial_access_v1.sql`
   SHA-256 `e9acee521d8a4daf8eacf20829598055927fccbf4df1dec822b95efeba0fe0e0`
2. `20260823104202_install_kiwify_webhook_v2_contract.sql`
   SHA-256 `d631eb47ccdabc9405e609cdeabd9f9080ae325359ad11c2b56f34d02ec45582`
3. `20260823000450_knowledge_area_v1.sql`
   SHA-256 `091b6748d1ba8f87cd5106c22230b5a5f8ba257a92427ba4e798f68100175b2e`
4. `20260823012822_extend_knowledge_editorial_contract_v1.sql`
   SHA-256 `b1aa17cb3405d6a7c297599d36539ad68a77d023d0d0aca1175b60c8820d4627`

Artefato protegido de importação (fora do Git):

- SQL server-side SHA-256
  `305ced774640c5582654abf96e3e8370fe744475925d11fcf919ef5b01414705`;
- arquivo canônico local SHA-256
  `24e5d8c1730abf560ec819ab0333236f603ff243a77c34bbde074660836a092f`;
- verificação editorial interna: `parts-1-4-v2` / canonical hash
  `9c9d90e12ea90f36ea85da291091ab9bb49b76590d9638c856f936dd41a670ad`.

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
| Kiwify | 2 funções + Edge Function v4 ativa | writer dual-compatible v15; reader e comprador novo homologados | deploy do writer antes do schema | gate de versão/hash |
| Knowledge | objetos ausentes | 1/4/26/1469 | criar schema e importar | RLS antes do conteúdo |
| Conteúdo | ausente | 67 sample / 1.402 knowledge | import server-side | hash/contagens exatos |
| Enforcement APP | não instalado | estado `false` | manter desligado | fase separada |

Contagens de referência do snapshot: 3 usuários Auth; 169 transactions; 14
recurring; 4 goals; 1 account; 1 card; 0 assets; 0 liabilities; 1 product; 1 grant;
2 payment events. Essas contagens são gates de preservação, não fixtures de escrita.

Histórico V82 de produção confirmado até `20260821205630`; nenhuma migration
Commercial/Kiwify V2/Knowledge estava registrada. Security Advisor de produção: zero
achados. A produção permaneceu read-only durante todo o gate.

## Compatibilidade e lints aceitos

- O preflight classifica a produção como `KIWIFY_LEGACY_GO` e valida nullability,
  defaults, quatro constraints de `payment_events`, FK `user_id` com `ON DELETE SET
  NULL`, policies, funções, grants e zero execução cliente da RPC de segredo.
- Produto, grant manual, dois eventos, payloads Kiwify e
  `set_kiwify_webhook_token(text)` são preservados. O `UNIQUE (user_id,product_id)`
  é substituído apenas após o preflight exato, permitindo histórico trial + paid.
- A Edge Function de produção `kiwify-webhook` v4 (source SHA-256
  `4e05db916526212b9b22bf9b2d44794e86d3008f9d23fb54f8a336b3c083c301`) faz
  `upsert` de grants com `onConflict: user_id,product_id`. Esse conflict target deixa
  de existir na migration V2. O novo writer detecta explicitamente legado ou V2,
  preserva esse upsert somente no legado e usa RPC transacional/idempotente no V2.
- A Beta executa o writer dual-compatible v15 (bundle SHA-256
  `df68b86291ece198236fb1a2d352cae4b9731bb3a8fe132c0850ae8861a06396`). O contrato
  SQL V2 fica em `20260823104202_install_kiwify_webhook_v2_contract.sql`; o período
  entre Commercial e esse contrato é fail-closed, nunca fallback legado inseguro.
- As seis tabelas server-only sem policy são deny-by-default; `anon` e
  `authenticated` não recebem writer direto. Classificação: **ACCEPTED**.
- `start_my_app_trial()` é `SECURITY DEFINER`, sem argumentos, usa `auth.uid()`,
  exige e-mail confirmado, tempo server-side, unicidade/lock e `search_path =
  pg_catalog`. Não permite escolher usuário ou expiração. Classificação: **ACCEPTED**.
- `search_path = pg_catalog` e RPC de trial sem argumentos reduzem a superfície de
  ataque; não ampliam acesso. Classificação: **ACCEPTED**.
- Leaked Password Protection está habilitada na produção e o Advisor está limpo.
  O aviso equivalente da Beta é pré-existente e não integra este gate.

## Matriz v4 × writer dual-compatible

| Evento | Produção v4 | Candidata dual | Legado | V2 | Risco e resultado |
|---|---|---|---|---|---|
| approved | cria/atualiza APP por `UNIQUE(user_id,product_id)` | mantém o caminho legado ou usa a RPC V2 transacional | sim | sim | **GO**; dual writer deve entrar antes da migration Commercial |
| renewal | repete o upsert do grant único | atualiza somente o APP elegível da assinatura | sim | sim | **GO**; não cria segundo grant ativo |
| cancellation | mantém acesso até `access_until`, quando informado | mantém APP até o fim pago e preserva KNOWLEDGE lifetime | sim | sim | **GO** |
| expiration | sem classificação explícita; apenas registra evento desconhecido | expira o APP vinculado, sem apagar dados | sim | sim | limitação v4 resolvida; **GO** somente com a candidata |
| full refund | revoga pelo `external_purchase_id` | revoga os grants vinculados à aquisição | sim | sim | **GO** |
| partial refund | sem semântica específica; registra sem decisão administrativa | `administrative_review`, sem mutar grants automaticamente | sim | sim | limitação v4 resolvida; **GO** |
| chargeback | usa o mesmo caminho de revogação do refund integral | suspende/revoga os grants vinculados conforme o contrato V2 | sim | sim | **GO** |
| retry | depende do evento legado e do conflito antigo | retorna `duplicate=true` por `provider + environment + external_event_id` | sim | sim | **GO**, zero efeito adicional |
| replay/out-of-order | pode concluir um update vazio e marcar o evento | falha fechada em `administrative_review` quando não há vínculo inequívoco | sim | sim | limitação v4 resolvida; **GO** |

O alvo removido `onConflict: user_id,product_id` permanece exclusivamente no helper
legado. O caminho V2 não depende dele: detecta o marker/contrato exato e chama
`process_kiwify_webhook_event_v2()`; estado parcial ou drift falha fechado.

## Evidência de reconciliação do writer

1. legado e V2 foram testados em clones descartáveis, com 1/1/2 rows históricas
   preservadas, retry, falha parcial, drift e zero grant ativo duplicado;
2. approval, renewal, late/grace, cancelamento, expiração, refund integral, refund
   parcial, chargeback e replay passaram remotamente somente na Beta;
3. dez eventos e três grants sintéticos foram verificados e removidos; nenhum payload
   bruto V2 foi persistido e o token efêmero foi apagado;
4. rollback de deploy para o bundle v4 foi exercitado na Beta e o writer dual foi
   restaurado imediatamente;
5. o `UNIQUE (user_id,product_id)` continua corretamente aposentado no V2.

O contrato de secrets permanece server-side: token Kiwify no Vault, nenhuma leitura
do valor neste gate, getter/setter/processador somente para `service_role`, HMAC/token
comparado em tempo constante e nenhum segredo no frontend ou Git. O reader dual
aceita com segurança o mínimo legado da v4; a rotação futura para 32+ caracteres é
hardening separado, não pré-condição oculta da migration.

## Correções homologadas no entrypoint real

A re-homologação da compatibilidade de token provou na Beta que:

- o reader aceita o contrato legado de 8 a 255 caracteres, sem aceitar vazio,
  whitespace periférico ou caracteres de controle;
- o setter V2 continua exigindo de 32 a 255 caracteres;
- autenticação incorreta falha com `401`, ausência de configuração falha com `503`;
- approval, retry idempotente, renewal, cancellation, refund e chargeback funcionam
  para usuário sintético já existente, sem grants ativos conflitantes;
- rollback para o bundle anterior foi exercitado durante o gate do reader;
- tokens e fixtures efêmeros foram removidos ao final.

O antigo caminho de comprador novo usava dois UUIDs e um separador, totalizando 73
bytes ASCII e excedendo o limite bcrypt. O bundle v15 usa 32 bytes de entropia de
`crypto.getRandomValues()` codificados em hexadecimal: 64 caracteres/bytes ASCII. O
entrypoint real foi testado com 1.000 gerações, criou exatamente um usuário Auth
confirmado, um grant APP e um payment event, e o retry retornou `duplicate=true` sem
duplicação. Zero payload bruto e zero conflito ativo foram observados. A limpeza
restaurou a Beta a 2 usuários Auth, 0 eventos/grants Kiwify e token não configurado.

## Ordem final para uma promoção futura e separadamente autorizada

1. confirmar backup físico, refs, SHAs e novo snapshot/preflight read-only;
2. comparar todos os hashes e contagens deste manifesto;
3. implantar o bundle Kiwify dual-compatible congelado sobre o schema legado;
4. testar um evento Kiwify controlado ainda no legado e provar retry/idempotência;
5. aplicar somente `20260822212119_commercial_access_v1.sql` em transação;
6. aplicar imediatamente `20260823104202_install_kiwify_webhook_v2_contract.sql`;
7. retestar Kiwify no V2 e validar 1 produto/1 grant/2 eventos legados preservados,
   funções Kiwify e
   `commercial_enforcement_state.enforced = false`;
8. validar explicitamente cobertura APP dos proprietários legados autorizados, sem
   ativar enforcement;
9. aplicar `20260823000450_knowledge_area_v1.sql` em transação;
10. aplicar `20260823012822_extend_knowledge_editorial_contract_v1.sql` em transação;
11. validar RLS, grants, RPCs e Advisors antes do conteúdo;
12. importar `parts-1-4-v2` server-side e idempotentemente;
13. validar 1/4/26/1469, 67/1.402, canonical hash e source hashes;
14. testar anon, APP, KNOWLEDGE, COMPLETE, revoked, FTS sem vazamento,
    progress/bookmarks e cross-user;
15. executar regressão financeira focal e teste de rollback seletivo;
16. somente depois preparar/deployar o frontend em etapa separada;
17. ativar enforcement financeiro apenas em autorização e janela próprias.

Parar imediatamente em checksum, schema, policy, função, contagem, hash, acesso,
Advisor de segurança ou preservação Kiwify divergente. Não usar `db push` genérico,
baseline, backfill por inferência ou conteúdo público.

## Rollback por camada

- **Antes da Commercial V2:** o bundle v4 congelado ainda é rollback temporário
  tecnicamente válido, porque `UNIQUE(user_id,product_id)` ainda existe no legado.
- **Depois da Commercial V2:** a v4 deixa de ser rollback seguro. O conflict target
  foi removido para preservar histórico; manter o dual writer e executar rollback
  application-first. Nunca voltar à v4 sobre o schema V2.
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

## Evidência final do clone fiel

O clone fiel reproduziu o legado de banco (1 produto, 1 grant manual, 2 eventos Kiwify),
exercitou o writer dual no legado e aplicou exatamente Commercial → contrato Kiwify
V2 → Knowledge → Editorial → conteúdo. Preservou todas as rows e payloads e chegou a
1/4/26/1469, 67/1.402. O resultado foi `109 pgTAP + 88` asserções shell; a suíte Node
do writer acrescentou 10 testes, e as suítes Commercial/Knowledge/editorial/ingestão
somaram 173 asserções. Retry completo, concorrência/idempotência, falha transacional,
drift incompatível, zero grant ativo conflitante, FTS sem vazamento, RLS, progress,
bookmarks, rollback seletivo e reimport foram aprovados.

Backup observado no painel oficial: físico de `2026-08-23 06:21:54 UTC`, Restore
disponível e retenção Pro de 7 dias. Backups físicos diários anteriores continuam
listados. Nenhuma restauração foi executada. Nenhuma rede Asaas, escrita na produção,
merge ou deploy oficial foi usado neste gate.

## Decisão do gate

- reader dual de token aprovado no legado e no V2;
- fluxo de comprador novo aprovado com senha temporária de 64 bytes;
- produto, grant, dois eventos e payloads históricos preservados;
- migrations e hashes congelados;
- pacote Beta-only excluído;
- conteúdo protegido fora do Git e hash canônico aprovado;
- backup e Advisor aprovados;
- rollback anterior/posterior à Commercial explicitamente separado;
- enforcement financeiro permanece desligado.

Resultado: **GO para repetir somente o Checkpoint 1 de produção mediante nova
autorização explícita**.
