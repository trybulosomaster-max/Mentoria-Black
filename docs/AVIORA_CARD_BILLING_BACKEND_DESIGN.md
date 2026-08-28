# AVIORA — Card Billing Backend V1 — desenho aprovado para Beta

## Estado do gate

`BACKEND_DESIGN_GATE = READY_FOR_BETA_APPROVAL`

`CARD_BILLING_BETA_READINESS = READY_FOR_APPROVAL`

`INITIAL_SCHEMA_MODE = SHADOW_ONLY`

`MUTATION_RPC_ACTIVATION = DORMANT`

`REMOTE_APPLY = PROHIBITED_PENDING_EXPLICIT_BETA_APPROVAL`

`BACKFILL_MODE = SAFE_NO_BACKFILL`

A migration candidata é `supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql`. Ela e seu rollback foram preparados e testados localmente; não foram aplicados em Beta nem em Produção. Estar pronto para aprovação significa que o schema shadow pode ser submetido ao gate humano de Beta. Não significa autorizar `db push`, SQL remoto, grants dos mutadores, ativação de UI ou mudança da fonte financeira atual.

O Visual V1, Saúde V2 e os motores financeiros atuais permanecem congelados.

## 1. Contratos financeiros preservados

- `transaction_date` continua sendo a competência financeira canônica.
- `purchase_date`, `closing_day` e `due_day` não reclassificam histórico.
- compra de cartão é a despesa econômica;
- ciclo/fatura é a obrigação agregada;
- pagamento é liquidação patrimonial, não nova despesa;
- cancelamento antes da efetivação é diferente de estorno após a efetivação;
- estorno/crédito é append-only e produz efeito na própria `effective_date`;
- materialização continua substituindo a projeção correspondente;
- Dashboard, Lançamentos, Planejamento e Relatórios não recebem uma segunda despesa pelo pagamento.

Invariante de ouro:

```text
conta inicial R$ 5.000
+ compra no cartão R$ 1.000
+ pagamento da fatura R$ 1.000
= saldo da conta R$ 4.000 e despesa econômica R$ 1.000
```

O schema shadow representa a saída de caixa separadamente, com `account_delta = -amount` e `consumption_expense_delta = 0`. Ele não insere pagamento em `transactions` como `despesa` e não altera saldos-base persistidos.

## 2. Schema final candidato

### `card_billing_cycles`

Um ciclo é único por usuário, cartão e fechamento efetivo. Persiste:

- `cycle_key`, sempre o primeiro dia do mês de vencimento;
- `closing_day_snapshot` e `due_day_snapshot`;
- `cycle_start_date`, `closing_date` e `due_date` efetivas;
- ownership composto por usuário e cartão.

Snapshots e datas são imutáveis. Editar `closing_day` ou `due_day` no cartão afeta apenas ciclos futuros; nunca move compra ou parcela já vinculada.

### `transactions.card_billing_cycle_id`

Vínculo explícito e nullable da compra/parcela com um ciclo. O histórico não recebe backfill automático. Um registro legado só pode ser estruturado quando seu `transaction_date` já coincide com a data de vencimento aprovada; caso contrário a operação falha sem reescrevê-lo.

### `card_invoice_payments`

Ledger append-only de `payment` e `payment_reversal`, com ciclo, conta de origem, valor `numeric(14,2)`, `effective_date`, `operation_id` idempotente e vínculo da reversão. Um pagamento pertence a um único ciclo V1.

### `card_payment_allocations`

Mantém normalização e auditabilidade, mas V1 exige exatamente uma allocation por entrada de pagamento e ela deve referenciar o mesmo ciclo e o mesmo valor. A tabela preserva espaço arquitetural para evolução futura sem liberar pagamento multi-ciclo agora.

### `card_account_settlements`

Marca, de forma append-only e 1:1, a liquidação de conta correspondente à entrada de pagamento. O trigger deferred exige que pagamento, allocation e settlement sejam gravados juntos na mesma transação lógica.

`card_account_settlement_effects_v1` expõe o efeito neutro:

```text
payment          -> account_delta negativo; consumption_expense_delta = 0
payment_reversal -> account_delta positivo; consumption_expense_delta = 0
```

### `card_purchase_credits`

Ledger append-only de `purchase_credit` e `credit_reversal`, sempre ligado à compra original. O cartão e o ciclo derivam da transaction, evitando cópias sujeitas a drift. O efeito econômico pertence à `effective_date`, preservando o mês histórico da compra.

### `card_installment_series`

Identidade imutável para parcelamentos novos, com usuário, cartão, `operation_id`, compra original, descrição, categoria, total de parcelas, valor original e origem. As transactions novas guardam `installment_series_id`, `installment_number` e `installment_total`; o total não nulo distingue o contrato V1 estruturado do identificador opaco já aceito pela V82. Trigger e constraint deferred exigem registro correspondente, sequência completa, competências mensais determinísticas e soma exata em centavos. Não se adiciona FK incondicional ao campo V82 porque isso quebraria writers legados em uma instalação shadow.

## 3. Calendário civil aprovado

O calendário usa exclusivamente `DATE`; timestamps técnicos não alteram competência.

Para um novo vínculo estruturado:

- `purchase_date` anterior ao fechamento efetivo: ciclo que fecha naquele mês;
- `purchase_date` na data do fechamento: o mesmo ciclo, com boundary inclusivo;
- `purchase_date` posterior ao fechamento: ciclo seguinte.

O helper clampa `closing_day` e `due_day` ao último dia válido do mês. Assim, dia 31 vira 30 em abril, 28 em fevereiro comum e 29 em fevereiro bissexto.

O vencimento é a primeira ocorrência clampada de `due_day` em ou após `closing_date`. Só avança para o mês seguinte quando o candidato clampado de vencimento fica antes do fechamento. `cycle_start_date` é o dia seguinte ao fechamento anterior e `cycle_key` é o mês de `due_date`.

Exemplos:

```text
fechamento 22 / vencimento 30:
compra 20/08 -> fechamento 22/08 -> vencimento 30/08
compra 22/08 -> fechamento 22/08 -> vencimento 30/08
compra 23/08 -> fechamento 22/09 -> vencimento 30/09

fechamento 30 / vencimento 31 em abril:
fechamento 30/04 -> vencimento clampado 30/04
```

Para novas transactions criadas pelo writer estruturado, `transaction_date = due_date`. Para histórico existente, a RPC apenas valida igualdade; nunca executa `SET transaction_date`.

## 4. Parcelas novas e histórico

`create_my_card_installment_series_v1` é idempotente por `user_id + operation_id`. Ela:

1. autentica e valida ownership do cartão;
2. cria uma série imutável;
3. divide o valor original em centavos sem drift;
4. cria de 1 a 120 parcelas completas;
5. atribui ciclos mensais usando o calendário congelado;
6. persiste cada parcela como `despesa` na competência do vencimento.

Duas séries do mesmo valor e descrição continuam distintas por identidade. Não há inferência automática por `note`, descrição, valor, proximidade de datas ou texto `X/Y`.

`BACKFILL_MODE = SAFE_NO_BACKFILL`: legado ambíguo permanece sem ciclo/série estruturados. Integridade prevalece sobre cobertura.

## 5. Pagamento, créditos e concorrência

### Pagamento mono-ciclo

`pay_my_card_invoice_v1` executa, atomicamente:

```text
autenticar
-> bloquear ciclo e conta do próprio usuário
-> calcular obrigação elegível já líquida de créditos
-> recusar credit balance pendente de contrato
-> recusar overpayment
-> inserir payment
-> inserir uma allocation do mesmo ciclo/valor
-> inserir um settlement neutro da conta
-> validar completude deferred
-> retornar saldo aberto
```

Pagamento parcial e integral são permitidos. Pagamento multi-ciclo automático e saldo credor por overpayment não fazem parte da V1.

### Créditos e estornos

Crédito reduz primeiro a obrigação do ciclo. Para fatura de R$ 1.000 com crédito de R$ 200, o pagamento máximo é R$ 800. Crédito total líquido nunca supera a compra original.

A compra original permanece intacta. Crédito de março para compra de janeiro produz o efeito compensatório em março. Reversões são novas linhas, referenciam a original e só podem ocorrer uma vez.

Se crédito + pagamento ultrapassarem a obrigação, o ciclo entra em `CREDIT_BALANCE_REVIEW_REQUIRED`. Não há carry-forward automático; novos pagamentos dependentes desse saldo falham fechados.

### Idempotência e race safety

- cada mutação usa `user_id + operation_id` único;
- retry com mesmo payload retorna a operação existente;
- retry com payload diferente falha;
- locks por operação, ciclo e registros financeiros serializam eventos concorrentes;
- constraints únicas impedem reversão, allocation e settlement duplicados;
- qualquer falha reverte toda a RPC.

## 6. Saldos, estados e limite gerencial

`card_invoice_balances_v1` deriva, sem persistir totais redundantes:

- comprado;
- creditado;
- pago;
- saldo aberto;
- saldo credor;
- `open`, `partially_paid`, `settled` ou `CREDIT_BALANCE_REVIEW_REQUIRED`.

Estados temporais como aberta, fechada, vence hoje e vencida são derivados das datas congeladas; não são persistidos e não podem sobrescrever o estado de liquidação.

`card_managed_limit_positions_v1` usa o contrato `AVIORA_MANAGED_AVAILABLE_LIMIT`:

```text
limite cadastrado
- obrigações estruturadas ainda abertas conhecidas pelo AVIORA
= limite gerencial disponível
```

Para séries novas, todas as parcelas são materializadas de forma estruturada e o valor total futuro conhecido compõe o comprometimento. Pagamentos e créditos liberam apenas a parte provada pelos ledgers.

O valor disponível é `NULL` quando:

- limite cadastrado é ausente/inválido;
- existe compra relevante não estruturada;
- a cobertura é parcial;
- existe `CREDIT_BALANCE_REVIEW_REQUIRED`.

O resultado nunca é descrito como limite oficial do emissor. O AVIORA não conhece necessariamente autorizações pendentes, juros, tarifas, ajustes externos ou compras não registradas.

## 7. Limite conhecido antes da ativação da UI

`accounts.balance_as_of` existe no contrato V82 e é necessário para combinar corretamente um saldo-base/snapshot com movimentos posteriores. O schema shadow expõe settlement e sua `effective_date`, mas a UI atual ainda não consome essa fonte.

Antes de ativar o pagamento ou o saldo de conta na UI, a integração precisa provar que aplica cada settlement exatamente uma vez e somente quando posterior ao `balance_as_of` coerente da conta. Essa integração de leitura é um gate separado.

`BALANCE_AS_OF_UI_INTEGRATION_REQUIRED` bloqueia ativação funcional da UI, mas não bloqueia aprovação/aplicação do schema shadow em Beta, porque:

- mutadores continuam sem grant para clientes;
- saldos-base não são alterados pela migration;
- os motores atuais não mudam sua fonte;
- o teste econômico pode validar a projeção shadow isoladamente.

## 8. RLS, grants e segurança

- RLS está ativa em todas as tabelas públicas novas;
- `anon` não lê nem muta;
- `authenticated` lê apenas próprias linhas;
- views usam `security_invoker = true`;
- mutadores são `SECURITY DEFINER`, têm `search_path` fixo, não usam SQL dinâmico e validam `auth.uid()`/ownership internamente;
- não existe parâmetro de `user_id` controlável pelo cliente nas RPCs públicas;
- FKs compostas provam mesmo usuário entre cartão, conta, ciclo, pagamento, allocation, settlement, crédito e transaction; séries V1 usam guard/constraint condicional porque o identificador legado V82 precisa continuar gravável;
- ledgers e séries são append-only/imutáveis;
- após existir qualquer ledger no ciclo, valor, status, competência, compra, cartão, tipo e vínculo da compra ficam imutáveis; eventos posteriores exigem operação compensatória explícita;
- valores monetários novos usam `numeric(14,2)`, exigem `> 0`, duas casas e limite de escala;
- RPCs mutadoras têm `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated` no shadow mode;
- apenas leituras shadow explicitamente aprovadas são concedidas.

Liberar mutadores exige migration de ativação separada, revisão de grants e aprovação explícita depois do shadow Beta.

## 9. Shadow mode e rollout

```text
novo backend calcula em isolamento
-> views comparam legado e estruturado
-> UI e motores atuais continuam como verdade visível
-> nenhuma mutation RPC é executável pelo cliente
```

Ordem segura:

1. aprovar explicitamente a aplicação Beta do schema shadow;
2. validar drift/preflight e aplicar somente em Beta;
3. rodar testes reais de RLS, grants, retry e concorrência no ambiente isolado;
4. popular apenas fixtures sintéticas/controladas;
5. comparar competências, ciclos, valores e efeitos de settlement;
6. fechar a integração `balance_as_of` da conta;
7. preparar migration separada de ativação dos mutadores;
8. só então preparar a UI de Cartões, sem alterar a verdade financeira vigente.

Não existe feature flag remota ativável nesta migration.

## 10. Rollback

### Instalação ainda vazia

O rollback destrutivo é permitido somente com lock exclusivo e quando não existir qualquer:

- série;
- ciclo;
- payment;
- allocation;
- settlement;
- crédito;
- transaction vinculada.

Também valida ownership do namespace privado e objetos esperados. Qualquer drift ou uso faz o script falhar fechado.

### Depois de uso real

Rollback é application-first: desabilitar consumidores/writers, preservar ledger e corrigir por forward migration. Nunca apagar histórico financeiro com `DROP`.

## 11. Decisões encerradas e limites V2

Encerrado para V1:

- calendário civil e boundary inclusivo no fechamento;
- clamp 28–31 e vencimento em/após fechamento;
- snapshots imutáveis;
- pagamento mono-ciclo parcial/integral;
- overpayment bloqueado;
- settlement neutro e auditável;
- crédito append-only na `effective_date`;
- crédito reduz obrigação antes do pagamento;
- limite gerencial rotulado e fail-closed;
- parcelas novas estruturadas;
- retenção do histórico;
- `numeric(14,2)` para novas estruturas;
- ausência de backfill heurístico.

Fora da V1:

- carry-forward de saldo credor excedente;
- pagamento automático multi-ciclo;
- reconciliação com limite oficial do emissor;
- autorizações, juros e tarifas externas;
- inferência de séries legadas;
- ativação da UI antes da integração `balance_as_of`;
- qualquer escrita remota sem gate humano próprio.

## 12. Critério de prontidão

Antes da aprovação Beta, a suíte local deve provar migration/rerun/drift, RLS A/B, anon, spoof, calendário, parcelas, pagamentos, créditos, races, reversões, rollback vazio/não vazio, teste econômico de ouro, regressão financeira e ausência de mudança visual.

`CARD_BILLING_BACKEND_READY_FOR_BETA_APPROVAL`

`VISUAL_V1_IMPACT = ZERO`

`HEALTH_V2_STATUS = FROZEN`
