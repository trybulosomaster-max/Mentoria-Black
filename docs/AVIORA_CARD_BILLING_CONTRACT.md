# AVIORA — Contrato V1 de fatura, liquidação e créditos de cartões

## Estado

`CONTRACT_GATE = BETA_VALIDATED`

`CARD_BILLING_BETA_ACTIVATION = APPLIED_VALIDATED`

`TEMPORAL_HARDENING_GATE = BETA_VALIDATED`

`BETA_UI_RPC_GRANTS = SIX_ACTIVE_TWO_DORMANT`

`PRODUCTION_APPLY = PROHIBITED`

`BACKFILL_MODE = SAFE_NO_BACKFILL`

As decisões de produto V1 abaixo estão implementadas e a migration de ativação foi validada somente no Beta `amzgqfvyjaiaoohnbcfl`. A UI e seus consumidores permanecem locais, sem publicação. Produção e `main` permanecem intactos.

## 1. Fontes de verdade

### Compra

Uma compra de cartão é uma `transaction` econômica do tipo `despesa`. Ela é reconhecida uma única vez nos contratos financeiros existentes.

### Competência

`transaction_date` é a competência canônica para Dashboard, Lançamentos, Planejamento, Relatórios, Metas e Cartões.

- histórico nunca é recalculado;
- `purchase_date` não move histórico;
- edição de fechamento/vencimento não move histórico;
- compra existente só recebe vínculo de ciclo se sua competência já corresponder ao calendário aprovado;
- compra/parcela nova recebe `transaction_date = due_date` pelo writer estruturado.

### Fatura

Fatura é a obrigação agregada de um ciclo. Ela não é uma segunda despesa.

### Pagamento

Pagamento reduz obrigação e conta de origem. Ele é neutro em consumo.

### Crédito/estorno

É evento compensatório append-only ligado à compra original e reconhecido em sua própria `effective_date`. Cancelamento não substitui crédito/estorno.

## 2. Data civil canônica

`BUSINESS_TIME_ZONE = America/Sao_Paulo`

“Hoje” significa a data civil corrente em São Paulo. Eventos V1 usam `DATE`, sem ambiguidade de horário intradiário.

- nenhum `effective_date` pode ser futuro;
- compra estruturada `realizado` não pode ter `purchase_date` ausente ou futura;
- posição histórica só inclui compra existente em `purchase_date <= position_as_of`;
- pagamento não pode anteceder a `purchase_date` de compra realizada elegível do ciclo;
- crédito deve ocorrer na `transaction_date` da compra ou depois;
- reversão deve ocorrer na `effective_date` da entrada original ou depois;
- `position_as_of` não pode ser futura;
- o frontend deve enviar/filtrar datas usando a mesma business date.

O contrato de ciclo permanece:

1. fechamento clampado no mês de `purchase_date`;
2. `purchase_date <= closing_date` pertence ao ciclo que fecha naquele dia;
3. compra posterior pertence ao próximo fechamento;
4. `due_date` é a primeira ocorrência clampada de vencimento em ou após o fechamento;
5. `cycle_key` é o primeiro dia do mês de `due_date`;
6. snapshots do ciclo ficam imutáveis.

## 3. Realizado versus compromisso

### Liquidável

Somente transaction de cartão com:

```text
transaction_type = despesa
status = realizado
card_billing_cycle_id estruturado
```

compõe `purchase_amount` e pode ser liquidada.

### Não liquidável

`pendente` e `programado` permanecem compromissos conhecidos:

- entram em `scheduled_purchase_amount`;
- entram em `known_commitment_amount`;
- alimentam leitura prospectiva e limite gerencial;
- não compõem o saldo pagável naquele momento.

Cancelado não entra. Status não suportado falha fechado.

### Ciclo misto

Se um ciclo contiver ao mesmo tempo compra realizada e qualquer compra não cancelada ainda pendente/programada/não suportada, `pay_my_card_invoice_v1` recusa todo o pagamento.

Não há pagamento silencioso apenas da parte realizada. A interface deve informar que o ciclo possui compromissos ainda não liquidáveis.

## 4. Snapshot EOD da conta

`statement_balance` é o saldo conferido ao fim do dia `balance_as_of`.

A fronteira é inclusiva no snapshot:

```text
snapshot contém efeitos em (-∞, balance_as_of]
posição aplica efeitos em (balance_as_of, position_as_of]
```

Portanto:

- efeito em `balance_as_of` já foi absorvido e não é reaplicado;
- efeito posterior ao snapshot e até `position_as_of` é aplicado uma vez;
- efeito futuro à posição é excluído;
- posição anterior ao snapshot é indisponível;
- ausência de `statement_balance` ou `balance_as_of` falha com `BALANCE_SNAPSHOT_REQUIRED`;
- payment/reversal exige `effective_date > balance_as_of`.

`get_my_card_account_positions_v1` e `projectAccountPositionsAsOf` devem produzir a mesma fronteira `(snapshot, asOf]`.

## 5. Liquidação neutra e atomicidade

Cada entrada V1 de pagamento usa um único ciclo explicitamente escolhido:

- parcial: permitido;
- integral: permitido;
- overpayment: proibido;
- multi-ciclo automático: fora da V1;
- ciclo misto: proibido;
- saldo credor em revisão (`CREDIT_BALANCE_REVIEW_REQUIRED`): novos pagamentos falham fechados.

Payment, allocation e account settlement formam uma unidade 1:1:1 e com o mesmo valor. Se qualquer insert/constraint falhar, toda a operação reverte.

| Evento | Conta | Consumo |
|---|---:|---:|
| pagamento | `-amount` | `0` |
| reversão do pagamento | `+amount` | `0` |

Não existe nova transaction de despesa para pagar a fatura. `statement_balance` também não é sobrescrito silenciosamente: a posição deriva o delta posterior ao snapshot.

Teste bloqueante:

```text
statement_balance = R$ 5.000 em balance_as_of
compra realizada = R$ 1.000
pagamento posterior = R$ 1.000
managed_balance = R$ 4.000
consumptionExpenseAmount = R$ 1.000
```

## 6. Créditos datados

- compra original é preservada;
- crédito referencia uma compra realizada estruturada;
- `effective_date >= transaction_date`;
- crédito líquido não ultrapassa o valor da compra;
- reversão referencia o crédito e o compensa integralmente;
- duplicate reversal é bloqueado;
- retry usa `operation_id` idempotente;
- crédito e reversão futuros são proibidos.

Efeito econômico:

```text
purchase_credit na data D  -> consumo em D diminui
credit_reversal na data R  -> consumo em R aumenta
```

O crédito não reabre nem reescreve o mês da compra original.

### Consumidores obrigatórios

O mesmo adapter datado e read-only alimenta:

- Dashboard;
- Planejamento;
- Relatórios;
- Saúde Financeira;
- agregações por categoria correspondentes.

O adapter deduplica entradas, rejeita dados/sinais/datas inválidos, exclui futuro e preserva Programado/Projetado/Previsão. Nenhum consumidor pode reinterpretar `effective_date` como `transaction_date` da compra.

## 7. Sete operações lógicas e oito wrappers

1. `structure_my_card_purchase_v1` — estrutura compra existente compatível;
2. `create_my_card_purchase_v1` — compra avulsa atômica;
3. `create_my_card_installment_series_v1` — série/parcelas atômicas; o wrapper `with_metadata` completa metadata dentro da mesma operação lógica;
4. `pay_my_card_invoice_v1` — liquidação mono-ciclo;
5. `reverse_my_card_payment_v1` — reversão do pagamento;
6. `credit_my_card_purchase_v1` — crédito da compra;
7. `reverse_my_card_purchase_credit_v1` — reversão do crédito.

A variante metadata-complete não constitui oitavo evento financeiro; é adapter da criação de parcelas para evitar DML pós-RPC.

No Beta, somente seis wrappers usados pela UI candidata possuem `EXECUTE` para `authenticated`:

- `create_my_card_installment_series_with_metadata_v1`;
- `create_my_card_purchase_v1`;
- `pay_my_card_invoice_v1`;
- `reverse_my_card_payment_v1`;
- `credit_my_card_purchase_v1`;
- `reverse_my_card_purchase_credit_v1`.

Permanecem dormentes e owner-only:

- `structure_my_card_purchase_v1`;
- `create_my_card_installment_series_v1` sem metadata.

Todos os writers devem ser:

- APP-gated;
- ownership-first;
- idempotentes;
- atômicos;
- `SECURITY DEFINER` com `search_path` fixo;
- sem parâmetro cliente de `user_id` efetivo;
- inacessíveis por implementação privada direta.

## 8. Private implementation / public wrapper

As implementações shadow previamente revisadas são movidas para `billing_private` e renomeadas como `*_shadow_impl_v1`.

- `PUBLIC`, `anon`, `authenticated` e `service_role` não recebem execução direta no schema privado;
- wrappers públicos validam auth, APP, ownership, data, snapshot, ciclo misto e payload;
- somente wrappers públicos explicitamente concedidos a `authenticated` podem alcançar a implementação;
- RLS continua isolando a leitura por usuário e APP ativo.

Essa separação impede que um cliente contorne as novas invariantes chamando a implementação shadow antiga.

## 9. APP gating

Todas as leituras e mutações de billing exigem:

```text
auth.uid() = user_id
AND has_active_access('APP') IS TRUE
```

Regras:

- APP concede o produto financeiro;
- KNOWLEDGE isolado não concede billing;
- acesso administrativo interno não substitui licença APP para operar dados de cliente;
- cross-user e anon falham;
- wrappers repetem a verificação mesmo quando RLS também protege tabelas.

Os grants de ativação foram aplicados e validados somente no Beta `amzgqfvyjaiaoohnbcfl`. Eles não existem na Produção, e o frontend permanece local e não publicado.

## 10. Leituras e posição

`get_my_card_billing_summary_as_of_v1` retorna, na posição solicitada:

- realizado liquidável cuja `purchase_date <= position_as_of`;
- pendente/programado conhecido;
- pagamentos/créditos com `effective_date <= position_as_of`;
- saldo aberto, saldo credor e estado de liquidação.

`get_my_card_billing_summary_v1` usa a business date atual de São Paulo.

`get_my_card_account_positions_v1` retorna snapshot, delta de settlements e managed balance em `(balance_as_of, position_as_of]`.

`card_managed_limit_positions_v1` continua gerencial:

```text
limite cadastrado
- compromissos estruturados conhecidos e ainda abertos
= limite disponível calculado pelo AVIORA
```

Retorna `NULL` quando cobertura, status, limite ou saldo credor não permitem número confiável. Não é limite oficial do emissor.

## 11. UI preservando o Visual V1

O candidato frontend usa o design system já homologado:

- nenhuma nova paleta ou shell;
- cards, rows, accordions, modais, botões e estados existentes;
- ações touch/teclado conforme primitives atuais;
- resumo primeiro, detalhe sob demanda;
- fallback legado explícito;
- saldo/limite indisponível não é fabricado.

As novas funções são profundidade de Cartões V2 sobre o Visual V1. O frontend ainda não foi publicado.

## 12. Backfill e legado

`BACKFILL_MODE = SAFE_NO_BACKFILL`

- activation preflight exige ledger/séries/ciclos shadow vazios;
- transactions não recebem vínculo automático;
- nenhuma inferência por `note`, descrição, valor, data aproximada ou `X/Y`;
- estrutura de legado exige correspondência canônica inequívoca;
- fallback legado permanece visível.

## 13. Idempotência e concorrência

1. `user_id + operation_id` identifica cada série/operação.
2. Mesmo payload retorna resultado existente.
3. Payload divergente falha.
4. Locks serializam ciclos, contas, compras e entradas originais.
5. Overpayment é verificado no saldo líquido serializado.
6. Reversão original só ocorre uma vez.
7. Payment/allocation/settlement é 1:1:1.
8. Qualquer falha desfaz toda a operação.

Essas invariantes passaram no PostgreSQL local descartável com sessões concorrentes e na validação transacional do Beta.

## 14. Rollout e status real

Estado atual:

- schema shadow base: aplicado e vazio no Beta;
- activation migration: aplicada no Beta como `20260828180524_aviora_card_billing_mutator_activation_v1`;
- revogação preventiva: aplicada como `20260828182727_revoke_card_billing_mutators_pending_review`;
- hardening temporal: aplicado como `20260828185650_harden_card_billing_temporal_contracts_v1`;
- reativação ACL-only: aplicada como `20260828192600_reactivate_card_billing_mutators_v1`;
- seis wrappers de UI: ativos para `authenticated`, APP-gated;
- dois wrappers de baixo nível: dormentes e owner-only;
- reativação atesta 59 fingerprints congelados: 11 funções públicas, 33 privadas e 15 definições exatas de triggers;
- rollback estrutural: validado em clone vazio e não executado no Beta;
- rollback ACL-only: validado para voltar todos os oito wrappers ao estado dormente sem remover dados;
- frontend/consumidores: candidatos locais não publicados;
- Beta: sequência aplicada, temporal/RLS/IDOR/APP/golden validados e fixtures removidas por `ROLLBACK`;
- Produção: intacta.

Próximos checkpoints:

1. versionar e enviar somente a feature branch em gate Git próprio;
2. manter frontend sem publicação neste gate;
3. exigir gate posterior para qualquer Produção ou `main`.

## 15. Rollback

Antes de uso, o rollback da ativação só pode restaurar o shadow mode quando tudo estiver vazio, sob lock exclusivo.

O rollback da reativação é ACL-only: revoga os oito wrappers, preserva schema e ledger e pode ser usado como primeira etapa de um rollback application-first.

Depois de qualquer série, ciclo, vínculo, payment, allocation, settlement ou crédito real:

```text
rollback application-first
-> revogar/desativar consumers e writers
-> preservar ledger e histórico
-> corrigir por forward migration
-> nunca executar DROP destrutivo
```

## 16. Fora da V1

- carry-forward automático de saldo credor;
- pagamento automático multi-ciclo;
- sincronização com emissor/limite bancário oficial;
- autorizações, juros e tarifas externas;
- backfill heurístico;
- qualquer escrita remota sem gate humano próprio.

`CARD_BILLING_MUTATOR_UI_BETA_VALIDATED`

`CARD_BILLING_TEMPORAL_HARDENING_VALIDATED`

`VISUAL_V1_IDENTITY = PRESERVED`
