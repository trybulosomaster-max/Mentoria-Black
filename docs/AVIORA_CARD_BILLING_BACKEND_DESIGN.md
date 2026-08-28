# AVIORA — Card Billing Backend Design Gate

## Resultado do gate

`BACKEND_DESIGN_GATE = READY_FOR_EXPLICIT_MIGRATION_REVIEW`

Nenhuma migration foi aplicada. Nenhum projeto Supabase foi acessado para escrita. A candidata local é `20260828130535_aviora_card_billing_backend_v1.sql`.

O desenho preserva o Visual V1 e os motores existentes. A ativação é deliberadamente faseada: primeiro schema/RPCs, depois reconciliação explícita do legado, depois writer integrado e somente por último enforcement. A migration não faz backfill, não muda lançamentos e não ativa enforcement.

## 1. Auditoria do estado atual

| Fonte atual | Contrato encontrado | Lacuna |
|---|---|---|
| `cards` | configuração: nome, instituição, bandeira, limite, fechamento e vencimento | sem ciclo, saldo ou liquidação |
| `transactions` | compra econômica, competência em `transaction_date`, cartão, série/parcela estruturada opcional | sem fatura persistida e sem pagamento agregado |
| `reversal_of_id` | reversão de transferência/investimento/resgate | não cobre despesa de cartão |
| `financialEffect()` | compra afeta despesa; transferência estruturada é neutra | cartão não é conta/clearing |
| RLS V82 | ownership por `user_id` e FKs compostas | ledger de cartão ainda ausente |

Decisão: `PERSISTED_INVOICE_REQUIRED`. Datas e totais podem ser derivados, mas ciclo congelado, pagamento parcial, pagamento integral, crédito e retry exigem persistência auditável.

## 2. Entidades propostas

### `card_billing_cycles`

Congela `cycle_key`, início, fechamento e vencimento por usuário/cartão. A chave do ciclo é o primeiro dia do mês da competência já persistida em `transaction_date`. Alterar `closing_day` ou `due_day` do cartão não move histórico.

### `transactions.card_billing_cycle_id`

Vínculo explícito da compra/parcela ao ciclo. Começa nullable para compatibilidade. Não existe backfill por descrição, `note`, valor, data de compra ou outra heurística.

### `card_invoice_payments`

Ledger append-only de `payment` e `payment_reversal`, com conta de origem, operação idempotente e reversão auditável. Não é uma transação de despesa.

### `card_purchase_credits`

Ledger append-only de `purchase_credit` e `credit_reversal`, sempre ligado à compra original e limitado ao seu valor líquido.

### Views

- `card_invoice_balances_v1`: valores comprado, creditado, pago, em aberto e crédito excedente; ciclo e liquidação em eixos separados.
- `card_limit_positions_v1`: limite cadastrado, comprometido e disponível. Limite igual ou menor que zero continua desconhecido (`NULL`). Disponibilidade pode ser negativa para expor excesso real, sem mascarar com zero.

## 3. Verdade financeira

```text
despesa econômica = compras de cartão efetivadas
fatura = agregação da obrigação
pagamento = redução da conta + redução da obrigação, sem nova despesa
crédito/estorno = evento compensatório ligado à compra, sem apagar histórico
```

O ledger de pagamentos precisa ser incorporado futuramente ao cálculo patrimonial da conta como saída neutra em consumo. Esta etapa não altera `financial-core.js`; portanto não existe risco de dupla contabilização no Visual V1. O frontend não deve exibir o novo saldo até essa integração passar por gate próprio.

## 4. Ciclo e competência

- A competência econômica continua sendo `transaction_date`.
- `cycle_key = primeiro dia do mês(transaction_date)`.
- `closing_date` é congelada no mês anterior ao vencimento.
- O dia de fechamento pertence ao ciclo que fecha naquele dia.
- Dias 29–31 são limitados ao último dia existente do mês.
- `due_date` é congelada no mês de `cycle_key`.
- Ciclo fechado não aceita novo vínculo pelo RPC.
- Transação já vinculada retorna o mesmo ciclo; não é movida automaticamente.

O RPC `attach_my_card_transaction_to_cycle_v1()` materializa essa regra sem reclassificar registros antigos. Antes de enforcement, o writer de lançamentos deve chamar uma operação atômica própria; o RPC de attach é a ponte de transição, não o estado final do writer.

## 5. Estados

### Eixo de ciclo

- `open`: antes do fechamento e não fechado explicitamente;
- `closed`: depois do fechamento, antes do vencimento, ou sem saldo vencido;
- `due`: vencimento hoje;
- `overdue`: vencimento passou e existe saldo aberto.

### Eixo de liquidação

- `empty`: sem compra;
- `unpaid`: compra sem pagamento;
- `partially_paid`: pagamento líquido positivo, menor que a obrigação;
- `paid`: obrigação integralmente coberta por pagamentos/créditos.

Uma fatura pode ser simultaneamente `overdue + partially_paid`; por isso um status único seria semanticamente incorreto.

## 6. Limite

Contrato V1 proposto:

```text
comprometido = soma dos saldos abertos de todos os ciclos persistidos
disponível = limite cadastrado - comprometido
```

Todas as parcelas materializadas e vinculadas comprometem limite, inclusive ciclos futuros. Projeções virtuais não comprometem limite. Pagamento e crédito liberam limite pelo valor líquido. Cancelado não entra no valor comprado. Um limite excedido produz disponibilidade negativa; o sistema não inventa uma recusa do emissor.

## 7. RPCs transacionais

| RPC | Papel | Concorrência/idempotência |
|---|---|---|
| `attach_my_card_transaction_to_cycle_v1` | vincular compra existente ao ciclo congelado | lock em transação e cartão; retry retorna o mesmo ciclo |
| `pay_my_card_invoice_v1` | pagamento parcial/integral | lock ciclo+conta; `operation_id`; rejeita overpayment |
| `reverse_my_card_payment_v1` | reversão integral auditável | uma reversão por pagamento |
| `credit_my_card_purchase_v1` | crédito/estorno parcial ou integral | lock compra+ciclo; crédito líquido não supera compra |
| `reverse_my_card_purchase_credit_v1` | reversão integral do crédito | uma reversão por crédito |
| `get_my_card_billing_summary_v1` | leitura rica do próprio usuário | `SECURITY INVOKER`, RLS e `auth.uid()` |

As mutações usam `SECURITY DEFINER` porque as três tabelas são read-only para clientes. Cada função fecha em `auth.uid()`, usa `search_path` controlado, valida ownership composto e tem `EXECUTE` concedido apenas a `authenticated`. Funções internas ficam em `billing_private`, sem grant ao cliente.

Ordem uniforme de locks: transação/registro original, ciclo, conta. O `operation_id` único fecha retry/replay; locks de linha serializam duas liquidações concorrentes do mesmo ciclo.

## 8. RLS e grants

- RLS ativa nas três tabelas.
- `anon`: nenhum grant.
- `authenticated`: somente `SELECT` nas tabelas e execução dos RPCs públicos aprovados.
- Policies: `SELECT TO authenticated USING ((select auth.uid()) = user_id)`.
- Não existe policy direta de insert/update/delete.
- Views são `security_invoker = true`, preservando RLS.
- `PUBLIC` e `anon` perdem `EXECUTE` em todos os RPCs.
- FKs compostas impedem misturar usuário/cartão/ciclo/conta/transação.
- Trigger privado valida card/usuário/competência, rejeita ciclo fechado e torna o vínculo imutável mesmo diante de update direto.

## 9. Invariantes

1. Uma compra vinculada pertence a um único ciclo.
2. Um ciclo é único por usuário, cartão e competência.
3. Datas do ciclo ficam congeladas.
4. Compra cancelada não compõe a obrigação.
5. Pagamento nunca entra como despesa econômica.
6. Pagamento não supera saldo aberto no instante bloqueado.
7. Crédito líquido não supera o valor da compra.
8. Reversão é append-only e não apaga o original.
9. Uma operação idempotente não produz duas linhas.
10. Uma origem só pode ser conta do mesmo usuário.
11. Nenhuma referência cross-user passa pelas FKs/RPCs.
12. Nenhum valor de limite depende de DOM, `note` ou agrupamento textual.
13. Parcela virtual não compromete limite; parcela materializada e vinculada compromete.
14. Dados legados permanecem intocados e não são inferidos.
15. Vínculo persistido não pode ser movido por edição posterior da compra.

## 10. Retry e concorrência

- `pg_advisory_xact_lock` serializa instalação da migration.
- Um advisory lock transacional por usuário/operação serializa retries concorrentes antes da checagem idempotente.
- RPCs usam `SELECT ... FOR UPDATE` no agregado que protege a invariante.
- Chaves `(user_id, operation_id)` garantem idempotência.
- Retry com mesmo payload retorna o registro original.
- Reutilizar `operation_id` com payload divergente falha com `23505` no pagamento.
- Índices parciais impedem duas reversões do mesmo registro.
- Deadlock deve ser retentado pelo cliente; a ordem de locks é fixa para reduzir sua ocorrência.

## 11. Estratégia de rollout

1. backup e preflight read-only;
2. aplicar schema/RLS/RPCs com Visual V1 ainda inalterado;
3. validar owner/cross-user/idempotência em transações com rollback;
4. reconciliar compras legadas somente por decisão explícita, nunca inferência;
5. implementar writer atômico de novas compras/parcelas;
6. integrar ledger à projeção patrimonial da conta e provar zero dupla despesa;
7. integrar Cartões V2 ao backend;
8. só então considerar enforcement de `card_billing_cycle_id`.

## 12. Rollback

### Preferencial: application-first

Reverter o consumidor, manter schema e ledger aditivos, desativar o writer novo e preservar dados. É o único rollback aceitável depois que existir qualquer pagamento, crédito ou vínculo.

### Schema rollback

`rollback_20260828130535_aviora_card_billing_backend_v1.sql` só executa se:

- pagamentos = 0;
- créditos = 0;
- nenhum `transaction.card_billing_cycle_id` preenchido.

Caso contrário falha fechado. Não existe ponto seguro para apagar ledger financeiro já utilizado.

## 13. Matriz de risco

| Risco | Severidade | Mitigação | Estado |
|---|---:|---|---|
| dupla contabilização compra + pagamento | crítica | pagamento fora de `transactions`; integração patrimonial em gate separado | CONTROLADO |
| cross-user | crítica | `auth.uid()`, FKs compostas, RLS e testes A/B | CONTROLADO NO DESIGN |
| pagamento duplicado/replay | alta | operação única + lock do ciclo | CONTROLADO NO DESIGN |
| dois pagamentos concorrentes excederem saldo | alta | `FOR UPDATE` no ciclo e recálculo dentro da transação | CONTROLADO NO DESIGN |
| crédito acima da compra | alta | lock da compra + soma líquida + check transacional | CONTROLADO NO DESIGN |
| backfill heurístico incorreto | alta | nenhum backfill; vínculo nullable | ELIMINADO |
| writer legado criar compra sem ciclo | alta | rollout em fases; writer atômico e enforcement futuros | ABERTO, NÃO BLOQUEIA INSTALAÇÃO ADITIVA |
| saldos de conta ignorarem pagamento | alta | não expor UI antes do gate de integração patrimonial | ABERTO, BLOQUEIA ATIVAÇÃO FUNCIONAL |
| lock DDL em `transactions` | média | janela controlada, `lock_timeout`, coluna nullable e FK `NOT VALID` | EXIGE PREFLIGHT |
| `SECURITY DEFINER` mal concedido | alta | search_path fixo, revoke PUBLIC/anon, auth.uid e ownership interno | CONTROLADO NO DESIGN |
| apagar ledger no rollback | crítica | rollback destrutivo recusa dados; application-first | ELIMINADO |
| mudança visual acidental | baixa | nenhum HTML/CSS/JS visual alterado | ELIMINADO |

## 14. Gates ainda obrigatórios

- `MIGRATION_EXECUTION_AUTHORIZATION_REQUIRED`;
- clone fiel com aplicação real da migration e pgTAP;
- revisão do plano de query das views;
- integração patrimonial do pagamento;
- writer atômico de compra/parcela;
- reconciliação explícita do legado;
- ativação funcional e enforcement em comandos separados.

`VISUAL_V1_IMPACT = ZERO`
