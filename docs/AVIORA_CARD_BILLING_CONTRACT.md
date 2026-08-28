# AVIORA — Contrato V1 de fatura e pagamento de cartões

## Decisão do gate

`CONTRACT_GATE = READY_FOR_BETA_APPROVAL`

`CARD_BILLING_BETA_READINESS = READY_FOR_APPROVAL`

`INITIAL_SCHEMA_MODE = SHADOW_ONLY`

`MUTATION_RPC_ACTIVATION = DORMANT`

`REMOTE_APPLY = PROHIBITED_PENDING_EXPLICIT_BETA_APPROVAL`

Este contrato fecha as decisões de produto necessárias para o backend candidato local. A migration continua não aplicada. O shadow schema pode ser levado à aprovação humana de Beta; as RPCs mutadoras não são concedidas a `authenticated`, a UI não muda de fonte e nenhuma fatura real pode ser paga por esse backend até uma migration de ativação posterior.

## 1. Fontes de verdade

### Compra

Uma compra de cartão é uma `transaction` econômica do tipo `despesa`. Ela é reconhecida uma única vez em Realizado, Programado ou Projetado conforme os contratos canônicos existentes.

### Competência

`transaction_date` é a competência canônica para Dashboard, Lançamentos, Planejamento, Relatórios, Metas e Cartões.

- histórico persistido nunca é recalculado;
- `purchase_date` não move histórico;
- edição de `closing_day` ou `due_day` não move histórico;
- uma transaction existente somente recebe vínculo estruturado se sua competência já estiver de acordo com o calendário aprovado.

### Fatura

Fatura é uma obrigação agregada persistente de um ciclo. Ela não é uma nova despesa.

### Pagamento

Pagamento reduz a conta de origem e a obrigação do ciclo. Ele é uma liquidação neutra em consumo.

### Crédito/estorno

É evento compensatório append-only ligado à compra original, reconhecido em sua própria `effective_date`. Cancelamento não substitui estorno.

## 2. Calendário de ciclo

O contrato usa data civil (`DATE`), sem corte intradiário nem conversão de timezone.

Para vínculos novos:

1. calcular o fechamento clampado no mês da compra;
2. se `purchase_date <= closing_date`, usar esse fechamento;
3. se `purchase_date > closing_date`, usar o fechamento do mês seguinte;
4. calcular `due_date` como a primeira ocorrência clampada de `due_day` em ou após o fechamento;
5. avançar o vencimento um mês somente quando o candidato clampado fica antes de `closing_date`;
6. definir `cycle_key` como o primeiro dia do mês de `due_date`;
7. definir `cycle_start_date` como o dia posterior ao fechamento anterior.

Clamping:

- 31 em abril vira 30;
- 31 em fevereiro comum vira 28;
- 31 em fevereiro bissexto vira 29;
- a mesma regra cobre 28, 29, 30, 31 e virada de ano.

O dia do fechamento pertence ao ciclo que fecha naquele dia.

Exemplos:

```text
fechamento 22 / vencimento 30:
20/08 -> fecha 22/08 -> vence 30/08
22/08 -> fecha 22/08 -> vence 30/08
23/08 -> fecha 22/09 -> vence 30/09

fechamento 30 / vencimento 31 em abril:
fecha 30/04 -> vence 30/04
```

Quando um writer cria uma compra/parcela estruturada nova, persiste `transaction_date = due_date`. Quando estrutura um registro existente, valida a data e falha se divergir; não reclassifica a transaction.

## 3. Ciclos e estados

Cada ciclo persiste snapshots de dias e datas efetivas. Esses campos são imutáveis depois da criação.

Os totais são derivados de compras, créditos, allocations e settlements; não são copiados para colunas mutáveis.

Estados de liquidação:

- `open`: existe saldo e nenhum pagamento líquido;
- `partially_paid`: existe pagamento líquido, mas ainda há saldo;
- `settled`: obrigação líquida zerada;
- `CREDIT_BALANCE_REVIEW_REQUIRED`: créditos + pagamentos excederam compras.

Estados temporais (`OPEN`, `CLOSED`, `DUE`, `OVERDUE`) podem ser derivados de `closing_date`, `due_date` e data civil corrente. Não são persistidos nem substituem o estado de liquidação.

## 4. Parcelas estruturadas

Novas séries exigem:

- `installment_series_id`;
- `installment_number`;
- `installment_total`;
- usuário e cartão coerentes;
- `operation_id` idempotente;
- valor total/original;
- uma competência estruturada por parcela.

A criação é atômica e cent-exact. Uma série 1x, 2x ou 12x deve conter exatamente a sequência declarada, ainda que atravesse dezembro/janeiro ou fevereiro.

Não há reconstrução histórica por `note`, descrição, valor, proximidade de datas ou texto `Parcelado X/Y`. Uma estrutura necessária para explicar parcelas existentes não pode ser apagada.

Compatibilidade shadow: `installment_series_id` e `installment_number` já pertencem ao contrato V82. Somente a presença de `installment_total` ativa as invariantes da série V1 e exige registro correspondente; writes legados sem esse total continuam válidos e não são promovidos por inferência.

`BACKFILL_MODE = SAFE_NO_BACKFILL`

## 5. Pagamento mono-ciclo

V1 adota pagamento direcionado a um único ciclo explicitamente escolhido.

- parcial: permitido;
- integral: permitido;
- multi-ciclo automático: não implementado;
- overpayment: falha fechado;
- pagamento com ciclo em saldo credor não resolvido: falha com `CREDIT_BALANCE_REVIEW_REQUIRED`.

A allocation permanece normalizada, mas cada entrada de pagamento V1 tem exatamente uma allocation do mesmo ciclo e do mesmo valor. Cada entrada também tem exatamente um settlement de conta.

A operação é atômica:

```text
validar auth/ownership
-> bloquear ciclo e conta
-> calcular saldo elegível líquido de créditos
-> inserir payment
-> inserir allocation mono-ciclo
-> inserir settlement neutro
-> validar completude
-> retornar saldo aberto
```

Se qualquer etapa falhar, nada persiste.

## 6. Liquidação neutra da conta

`card_account_settlement_effects_v1` é a fonte shadow do efeito patrimonial:

| Evento | Conta | Consumo |
|---|---:|---:|
| pagamento | `-amount` | `0` |
| reversão do pagamento | `+amount` | `0` |

Não é criado um novo `transaction_type` de despesa, não se altera `opening_balance`/`statement_balance` e não se duplica `consumptionExpenseAmount`.

Teste econômico bloqueante:

```text
saldo inicial = R$ 5.000
compra = R$ 1.000
pagamento = R$ 1.000
saldo projetado shadow = R$ 4.000
despesa econômica = R$ 1.000
Dashboard / Planejamento / Relatórios = R$ 1.000, nunca R$ 2.000
```

### Limitação `balance_as_of`

O runtime atual reconstrói contas a partir de saldo-base e movimentos. Integrar settlements na UI exige filtrar cada efeito pela fronteira correta de `accounts.balance_as_of`, evitando somar novamente um evento já absorvido por snapshot manual.

`BALANCE_AS_OF_UI_INTEGRATION_REQUIRED` bloqueia a ativação funcional da UI e dos mutadores, mas não o schema shadow: a migration não altera saldos-base, os mutadores permanecem dormentes e a projeção pode ser validada isoladamente em Beta.

## 7. Créditos e estornos

- a compra original é preservada;
- o crédito referencia a compra;
- o efeito econômico pertence à `effective_date` do crédito;
- crédito líquido não ultrapassa o valor original;
- a reversão referencia o crédito e o compensa integralmente;
- duplicate reversal é bloqueado;
- retry usa `operation_id` idempotente;
- concorrência é serializada por compra/ciclo.

Créditos reduzem a obrigação antes do pagamento:

```text
compras R$ 1.000
- créditos R$ 200
= pagamento máximo R$ 800
```

Se um crédito posterior a um pagamento criar saldo abaixo de zero, a V1 não transporta automaticamente o excedente para outro ciclo. O estado é `CREDIT_BALANCE_REVIEW_REQUIRED` e operações dependentes falham fechadas.

## 8. Limite gerencial

Nome canônico:

`AVIORA_MANAGED_AVAILABLE_LIMIT`

Rótulo de produto futuro:

`Limite disponível calculado pelo AVIORA`

Fórmula shadow:

```text
limite cadastrado
- soma das obrigações estruturadas ainda abertas conhecidas pelo AVIORA
= limite gerencial disponível
```

Para parcelamentos novos, a série cria todas as parcelas futuras estruturadas; portanto o valor contratado conhecido compõe o comprometimento e é liberado conforme pagamentos/créditos comprovados.

O valor disponível é `NULL`, nunca inventado, quando o limite é inválido, existe compra relevante sem estrutura, a cobertura é parcial ou há saldo credor em revisão.

Não é limite bancário em tempo real. Pode divergir por autorizações pendentes, juros, tarifas, ajustes do emissor e movimentos ausentes no AVIORA.

## 9. Idempotência, concorrência e invariantes

1. `user_id + operation_id` identifica de forma única cada série/pagamento/crédito/reversão.
2. Mesmo payload em retry retorna o resultado existente; payload divergente falha.
3. Locks de operação e de recursos impedem dois pagamentos de consumirem o mesmo saldo.
4. Overpayment é verificado contra saldo já líquido de créditos no instante serializado.
5. Payment, allocation e settlement são uma unidade atômica 1:1:1.
6. Original e reversão são append-only e uma original só pode ser revertida uma vez.
7. Ciclo, cartão, conta, compra e ledgers pertencem ao mesmo usuário.
8. Snapshots de ciclo e identidades de parcelas são imutáveis.
9. Depois de qualquer ledger no ciclo, a compra não pode mudar valor, status, competência, data de compra, cartão, tipo ou vínculo; correções econômicas são append-only.
10. Nenhuma compra/parcela aparece duas vezes.
11. Pagamento não é nova despesa econômica.
12. Histórico nunca é reclassificado automaticamente.
13. Limite nunca depende de DOM, `note` ou heurística textual.

## 10. RLS e exposição

- tabelas novas têm RLS;
- `authenticated` recebe somente `SELECT` próprio;
- `anon` não recebe acesso;
- views são `security_invoker`;
- funções mutadoras são `SECURITY DEFINER` com `search_path` fixo e ownership interno;
- nenhum `user_id` efetivo é aceito do cliente;
- não existe SQL dinâmico;
- grants mutadores ficam revogados no shadow mode;
- apenas resumo/views shadow de leitura podem ser consultados pelo próprio usuário.

Uma migration de ativação futura precisa conceder funções explicitamente; não pode herdar `EXECUTE` de `PUBLIC`.

## 11. Shadow mode, backfill e rollback

### Shadow

```text
schema novo calcula
UI antiga continua canônica
mutadores continuam inacessíveis
comparação mede cobertura sem reclassificar histórico
```

Não há feature flag remota nesta candidata.

### Backfill

Nenhum backfill automático. Associação histórica ambígua fica `NULL`. Cobertura parcial é informada, não “corrigida” por heurística.

### Rollback

Antes de uso, o rollback destrutivo requer schema vazio e lock exclusivo. Qualquer série, ciclo, pagamento, allocation, settlement, crédito ou vínculo bloqueia o `DROP`.

Depois de uso real: rollback application-first e migration forward corretiva. Histórico financeiro nunca é removido para voltar versão.

## 12. Ativação e limites V2

Próximos passos, sem execução automática:

1. aprovação humana para aplicar o schema shadow em Beta;
2. RLS/grants/races reais em Beta isolada com fixture sintética;
3. validação shadow de calendário, totals, parcelas e teste de ouro;
4. integração de leitura baseada em `balance_as_of`;
5. migration separada para grants dos mutadores;
6. gate futuro da UI de Cartões.

Ficam fora da V1:

- saldo credor excedente/carry-forward;
- pagamento automático multi-ciclo;
- sincronização com emissor e limite bancário oficial;
- autorizações, juros e tarifas externos;
- reconstrução heurística de séries legadas;
- ativação da UI sem integração segura de `balance_as_of`.

Gates não relacionados continuam congelados:

- `HEALTH_V2_FROZEN`;
- Reserva cross-device;
- Conhecimento V1 fora deste gate.

`CARD_BILLING_BACKEND_READY_FOR_BETA_APPROVAL`

`VISUAL_V1_IMPACT = ZERO`
