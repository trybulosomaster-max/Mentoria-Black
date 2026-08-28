# AVIORA — Card Billing Backend V1 — ativação validada em Beta

## Estado do gate

`BACKEND_ACTIVATION_GATE = BETA_VALIDATED`

`CARD_BILLING_BETA_ACTIVATION = APPLIED_VALIDATED`

`TEMPORAL_HARDENING_GATE = BETA_VALIDATED`

`MUTATION_RPC_ACTIVATION = SIX_UI_WRAPPERS_BETA_AUTHENTICATED_APP_GATED`

`LOW_LEVEL_RPC_STATE = TWO_WRAPPERS_DORMANT`

`FRONTEND_ACTIVATION = LOCAL_CANDIDATE_NOT_PUBLISHED`

`PRODUCTION_APPLY = PROHIBITED`

`BACKFILL_MODE = SAFE_NO_BACKFILL`

O schema persistente base permanece em `supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql`. A sequência controlada aplicada somente no Beta `amzgqfvyjaiaoohnbcfl` foi:

1. ativação inicial: `20260828180524_aviora_card_billing_mutator_activation_v1`;
2. revogação preventiva durante a revisão: `20260828182727_revoke_card_billing_mutators_pending_review`;
3. hardening temporal: `20260828185650_harden_card_billing_temporal_contracts_v1`;
4. reativação ACL-only: `20260828192600_reactivate_card_billing_mutators_v1`.

Produção não recebeu nenhuma dessas migrations. Os consumidores frontend permanecem locais e não publicados.

A aplicação Beta preservou o baseline histórico, executou fixtures sintéticas somente em transações revertidas e terminou com as seis tabelas de ledger vazias. Não houve dado real, deploy frontend, publicação, escrita em Produção ou alteração de `main`.

O Visual V1 permanece como identidade e sistema de componentes; o gate acrescenta comportamento funcional sem abrir uma nova repaginação.

## 1. Verdades financeiras preservadas

- `transaction_date` continua sendo a competência financeira canônica.
- `purchase_date`, fechamento e vencimento não reclassificam histórico.
- Compra de cartão é a despesa econômica.
- Fatura/ciclo é obrigação agregada, não uma segunda despesa.
- Somente compra `realizado` é liquidável.
- Compra `pendente` ou `programado` é compromisso conhecido, mas não é liquidável.
- Pagamento reduz obrigação e conta; seu efeito sobre consumo é sempre zero.
- Crédito/estorno é evento compensatório append-only na própria `effective_date`.
- Cancelamento não substitui crédito/estorno.
- Realizado, Programado, Projetado e Previsão preservam seus contratos existentes.
- Valores monetários novos do ledger usam `numeric(14,2)` e validação fail-closed de escala, sinal e limite.

Teste econômico de ouro:

```text
conta no snapshot = R$ 5.000
compra realizada no cartão = R$ 1.000
pagamento da fatura = R$ 1.000
posição gerencial da conta = R$ 4.000
despesa econômica = R$ 1.000, nunca R$ 2.000
```

## 2. Data civil do produto

`BUSINESS_TIME_ZONE = America/Sao_Paulo`

Todas as fronteiras de “hoje” do contrato usam a data civil obtida em `America/Sao_Paulo`. Não há corte intradiário para os eventos financeiros V1; compras, pagamentos, reversões e créditos usam `DATE`.

Regras da ativação:

- `effective_date` de pagamento, reversão de pagamento, crédito e reversão de crédito não pode estar no futuro em relação à data civil de São Paulo;
- compra estruturada em estado `realizado` não pode ter `purchase_date` ausente ou futura;
- posição histórica só inclui compra cuja `purchase_date <= position_as_of`;
- pagamento não pode ter `effective_date` anterior à `purchase_date` de qualquer compra realizada elegível do ciclo;
- crédito não pode anteceder a `transaction_date` da compra realizada;
- reversão não pode anteceder a `effective_date` da entrada original;
- leituras `as_of` recusam data futura;
- o calendário de ciclo continua usando snapshots civis imutáveis e boundary inclusivo no fechamento.

## 3. Elegibilidade da fatura

`card_invoice_balances_v1` separa três leituras:

- `purchase_amount`: somente despesas `realizado`, portanto liquidáveis;
- `scheduled_purchase_amount`: despesas `pendente` ou `programado`, ainda não liquidáveis;
- `known_commitment_amount`: soma de realizado + pendente + programado para previsão e limite gerencial.

O pagamento é fail-closed. Se um ciclo possuir qualquer despesa não cancelada que não esteja em `realizado`, a RPC recusa o pagamento inteiro com ciclo misto. Isso inclui:

- realizado + pendente;
- realizado + programado;
- status não suportado;
- ciclo composto somente por compromissos futuros.

Não se paga apenas a parcela realizada de um ciclo misto, porque isso produziria uma fatura parcialmente elegível ambígua. A UI deve explicar o bloqueio e manter os compromissos visíveis.

Créditos e pagamentos só reduzem o saldo liquidável realizado. Compromissos pendentes/programados continuam sendo apresentados separadamente.

## 4. Snapshot de conta e posição temporal

`accounts.statement_balance` representa o saldo conferido no fim do dia indicado por `accounts.balance_as_of`.

`balance_as_of` é uma fronteira EOD inclusiva: tudo que ocorreu até e incluindo aquela data já está absorvido no snapshot. Para uma posição em `position_as_of`, somente movimentos e settlements no intervalo abaixo podem ser reaplicados:

```text
(balance_as_of, position_as_of]
```

Consequências:

- evento na mesma data de `balance_as_of` não é somado novamente;
- evento posterior ao snapshot e até `position_as_of`, inclusive, é aplicado uma vez;
- evento após `position_as_of` é excluído;
- `position_as_of < balance_as_of` retorna `HISTORICAL_POSITION_UNAVAILABLE`;
- snapshot ausente retorna `BALANCE_SNAPSHOT_REQUIRED`;
- pagamento/reversão exige `effective_date > balance_as_of` da conta escolhida;
- pagamento/reversão com data futura é proibido.

`get_my_card_account_positions_v1()` implementa essa fronteira no banco. `projectAccountPositionsAsOf()` aplica o mesmo contrato no frontend a movimentos canônicos e settlements, sem duplicar evento já absorvido pelo snapshot.

## 5. Liquidação neutra

Pagamento, allocation e settlement formam uma unidade atômica 1:1:1 na V1:

```text
payment
-> allocation do mesmo valor para um único ciclo
-> account settlement da mesma conta/operação
```

`card_account_settlement_effects_v1` expõe:

| Evento | `account_delta` | `consumption_expense_delta` |
|---|---:|---:|
| pagamento | `-amount` | `0` |
| reversão | `+amount` | `0` |

O pagamento não cria uma `transaction` de despesa e não altera silenciosamente o snapshot persistido. A posição da conta é derivada a partir do snapshot mais efeitos posteriores.

## 6. Créditos datados e consumidores

`card_purchase_credit_effects_v1` mantém o crédito ligado à compra original, mas reconhece o efeito econômico na data do evento:

| Evento | Efeito no consumo |
|---|---:|
| `purchase_credit` | `-amount` |
| `credit_reversal` | `+amount` |

O adapter compartilhado de frontend:

- exige identidade de entrada/operação;
- rejeita duplicidade;
- valida kind, valor, sinal e data;
- exclui efeito futuro;
- preserva cartão, ciclo, categoria e subcategoria;
- produz ajuste read-only, sem criar transaction falsa.

Consumidores datados no candidato local:

- Dashboard;
- Planejamento;
- Relatórios;
- Saúde Financeira, reutilizando o Realizado ajustado sem alterar pesos/fórmula;
- detalhes categóricos correspondentes.

Crédito afeta somente Realizado na própria `effective_date`. Programado, Projetado e Previsão futura não são reclassificados pelo adapter.

## 7. Implementações privadas e wrappers públicos

A migration de ativação move as implementações shadow já revisadas para `billing_private`, renomeia-as como `*_shadow_impl_v1` e revoga acesso direto de `PUBLIC`, `anon`, `authenticated` e `service_role`.

Os entrypoints públicos são wrappers `SECURITY DEFINER` com `search_path = pg_catalog`. Eles são a única superfície cliente e executam, antes de chamar a implementação privada:

- autenticação por `auth.uid()`;
- `has_active_access('APP')`;
- ownership de cartão, conta, ciclo, goal e transaction;
- data civil não futura;
- snapshot obrigatório quando houver efeito de conta;
- elegibilidade Realizado e bloqueio de ciclo misto;
- idempotência e validação do payload.

As policies RLS das tabelas de billing também exigem ownership e acesso APP estritamente verdadeiro (`has_active_access('APP') IS TRUE`). CUSTOMER sem APP, usuário anônimo e outro usuário não recebem leitura nem mutação.

## 8. Sete operações lógicas e oito wrappers

A superfície de negócio possui sete writers lógicos:

1. `structure_my_card_purchase_v1` — estrutura compra existente sem reclassificar `transaction_date`;
2. `create_my_card_purchase_v1` — cria compra avulsa, ciclo e competência de forma atômica;
3. `create_my_card_installment_series_v1` — cria série e todas as parcelas; a variante `with_metadata` é o adapter metadata-complete da mesma operação lógica, não um oitavo evento financeiro;
4. `pay_my_card_invoice_v1` — pagamento parcial/integral de um ciclo exclusivamente realizado;
5. `reverse_my_card_payment_v1` — reversão integral e datada do pagamento;
6. `credit_my_card_purchase_v1` — crédito parcial/integral de compra realizada;
7. `reverse_my_card_purchase_credit_v1` — reversão integral e datada do crédito.

Estrutura, compra avulsa e parcelas preservam a competência derivada pelo calendário aprovado. Payment/reversal e credit/reversal são append-only, idempotentes e protegidos por locks/constraints. A concorrência foi validada em PostgreSQL local descartável com sessões independentes; no Beta, a validação transacional confirmou idempotência e atomicidade sem deixar fixtures persistidas.

A variante metadata-complete cria um oitavo wrapper público, embora continue representando a mesma operação lógica de parcelamento. A reativação Beta concede a `authenticated` somente os seis entrypoints consumidos pela UI candidata:

- `create_my_card_installment_series_with_metadata_v1`;
- `create_my_card_purchase_v1`;
- `pay_my_card_invoice_v1`;
- `reverse_my_card_payment_v1`;
- `credit_my_card_purchase_v1`;
- `reverse_my_card_purchase_credit_v1`.

Os dois wrappers de baixo nível permanecem owner-only e dormentes:

- `structure_my_card_purchase_v1`;
- `create_my_card_installment_series_v1` sem metadata.

## 9. Leituras públicas

- `get_my_card_billing_summary_as_of_v1(card, position_as_of)` exclui compras com `purchase_date` posterior à posição e payments/créditos posteriores à posição solicitada;
- `get_my_card_billing_summary_v1(card)` é o adapter para a data civil atual de São Paulo;
- `get_my_card_account_positions_v1(account, position_as_of)` aplica settlements em `(balance_as_of, position_as_of]`;
- `card_managed_limit_positions_v1` preserva o contrato `AVIORA_MANAGED_AVAILABLE_LIMIT` e retorna `NULL` quando a cobertura não permite precisão gerencial.

As leituras também são APP-gated e ownership-first.

## 10. UI sobre o Visual V1

O frontend candidato reutiliza o Visual V1 congelado:

- shell, tokens, cards, accordions, modais, StatusChip e ResponsiveDataRow atuais;
- leitura de ciclos, realizado liquidável e compromissos conhecidos;
- limite gerencial com aviso de cobertura;
- saldo de conta posicionado pelo snapshot;
- pagamentos, créditos e reversões por ações explícitas;
- agrupamento de compras por mês/dia, busca e parcelas estruturadas;
- fallback legado identificado, sem fabricar fatura.

Não há nova paleta, novo shell ou mudança da identidade aprovada. Trata-se de profundidade funcional. O frontend ainda é local e não foi publicado.

## 11. RLS, grants e APP gating

- todas as tabelas novas mantêm RLS;
- policies combinam `(select auth.uid()) = user_id` com `(select has_active_access('APP'))`;
- `anon` e cross-user falham;
- implementações privadas não são executáveis por papéis clientes;
- somente os seis wrappers consumidos pela UI são concedidos explicitamente a `authenticated`;
- os dois wrappers de baixo nível, todas as implementações privadas, `PUBLIC`, `anon` e `service_role` permanecem sem `EXECUTE`;
- nenhum `user_id` efetivo é aceito como parâmetro cliente;
- não há SQL dinâmico;
- payment/allocation/settlement, créditos, ciclos e séries preservam invariantes estruturais.

Esses seis grants estão ativos somente no Beta `amzgqfvyjaiaoohnbcfl`. A reativação é ACL-only e valida antes do grant 59 fingerprints congelados: 11 funções públicas, 33 funções privadas e as definições exatas de 15 triggers. Permanecem ausentes da Produção, e o frontend ainda não foi publicado.

## 12. Backfill e compatibilidade

`BACKFILL_MODE = SAFE_NO_BACKFILL`

A ativação exige shadow ledger vazio e nenhuma transaction já estruturada. Não há associação automática por `note`, descrição, valor, texto `X/Y` ou data aproximada.

- histórico legado permanece intacto;
- estrutura de compra existente exige correspondência exata com o calendário;
- novas compras/parcelas usam writers atômicos;
- fallback legado permanece visível até reconciliação explícita futura.

## 13. Rollout validado

Checkpoints concluídos para o Beta:

1. concluir testes locais de activation migration, rollback, RLS, grants e financial consumers;
2. executar migration + pgTAP em clone fiel descartável;
3. validar APP/no-APP, OWNER/STAFF/CUSTOMER, cross-user e anon;
4. validar business date de São Paulo e boundaries de snapshot;
5. provar Realizado liquidável, compromisso não liquidável e ciclo misto bloqueado;
6. provar os seis wrappers de UI, manter dois wrappers de baixo nível dormentes e validar retry, races e reversões;
7. provar o teste econômico de ouro e créditos datados em todos os consumidores;
8. validar Visual V1 e mobile;
9. auditar secrets/diff;
10. aplicar ativação, revogação preventiva, hardening temporal e reativação ACL-only somente no Beta;
11. provar `purchase_date <= position_as_of`, rejeição de compra realizada futura, cronologia de pagamento e APP fail-closed;
12. confirmar cleanup integral, seis tabelas shadow vazias e baseline histórico idêntico.

`BETA_VALIDATION = PASS`

## 14. Rollback

### Antes do primeiro uso

O rollback estrutural candidato pode restaurar o shadow mode apenas quando todas as estruturas e vínculos estão vazios, sob lock exclusivo. Qualquer ciclo, série, payment, allocation, settlement, crédito ou transaction estruturada faz o script falhar fechado. A reativação possui rollback ACL-only separado, que apenas revoga os oito wrappers e preserva todos os dados.

### Depois de qualquer uso real

Rollback é obrigatoriamente application-first:

1. revogar/desativar consumidores e writers;
2. preservar todos os ledgers e vínculos;
3. corrigir por migration forward;
4. nunca apagar histórico financeiro com `DROP`.

## 15. Limites mantidos fora da V1

- carry-forward automático de saldo credor;
- pagamento automático multi-ciclo;
- limite bancário oficial/integração com emissor;
- autorizações pendentes, juros e tarifas externas;
- backfill heurístico de séries legadas;
- escrita remota sem gate humano próprio.

## 16. Critério de prontidão

O hardening temporal e a superfície mínima de seis RPCs estão aplicados e validados no Beta. A UI permanece candidata local, sem publicação; qualquer promoção de frontend, Produção ou `main` exige gate próprio.

`CARD_BILLING_MUTATOR_UI_BETA_VALIDATED`

`CARD_BILLING_TEMPORAL_HARDENING_VALIDATED`

`VISUAL_V1_IDENTITY = PRESERVED`

`HEALTH_V2_FORMULA = FROZEN`
