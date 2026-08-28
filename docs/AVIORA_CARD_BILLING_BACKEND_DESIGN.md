# AVIORA — Card Billing Backend Design Gate

## Resultado da revisão

`BACKEND_DESIGN_GATE = PRODUCT_DECISION_REQUIRED`

`CARD_BILLING_BETA_READINESS = HOLD`

`INITIAL_SCHEMA_MODE = SHADOW_ONLY`

`REMOTE_APPLY = PROHIBITED_PENDING_PRODUCT_DECISIONS_AND_RUNTIME_VALIDATION`

Nenhuma migration foi aplicada e nenhum projeto Supabase foi acessado para escrita. A candidata local é `20260828130535_aviora_card_billing_backend_v1.sql`.

O desenho local é uma base útil, mas ainda não autoriza ativação funcional. A camada inicial deve permanecer aditiva e em shadow mode: pode preparar schema, RLS, views e RPCs para validação isolada, porém as RPCs mutadoras ficam sem `EXECUTE` para `authenticated` até as decisões de produto, a integração contábil da conta e os testes reais de RLS/concorrência passarem. O Visual V1 e os motores atuais permanecem congelados.

## 1. Auditoria do estado atual

| Fonte atual | Contrato encontrado | Lacuna |
|---|---|---|
| `cards` | configuração: nome, instituição, bandeira, limite, fechamento e vencimento | sem ciclo, saldo ou liquidação |
| `transactions` | compra econômica, competência em `transaction_date`, cartão, série/parcela estruturada opcional | sem fatura persistida e sem pagamento agregado |
| `reversal_of_id` | reversão de transferência/investimento/resgate | não cobre despesa de cartão |
| `financialEffect()` | compra afeta despesa; transferência estruturada é neutra | cartão não é conta/clearing |
| RLS V82 | ownership por `user_id` e FKs compostas | ledger de cartão ainda ausente |

Decisão confirmada: uma fatura liquidável exige persistência auditável. Permanecem abertas as decisões sobre calendário automático, forma contábil da liquidação, alocação de pagamentos, crédito, limite gerencial, séries parceladas e retenção.

## 2. Entidades locais propostas

### `card_billing_cycles`

Persiste snapshots explícitos de `cycle_key`, início, fechamento e vencimento por usuário/cartão. A candidata não contém helper de calendário nem RPC para construir/anexar ciclo: essas datas precisam ser fornecidas por um writer privilegiado futuro, depois da decisão de produto. Snapshots são imutáveis após inserção. O único contrato fechado é que `transaction_date` continua sendo a competência histórica canônica e jamais pode ser recalculada por fechamento ou vencimento.

### `transactions.card_billing_cycle_id`

Vínculo explícito e nullable da compra/parcela ao ciclo. Não há inferência histórica por descrição, `note`, valor, proximidade temporal ou data de compra.

### `card_invoice_payments`

Candidato normalizado a ledger append-only de `payment` e `payment_reversal`, com `user_id`, `billing_cycle_id`, conta de origem e operação idempotente. Não persiste `card_id`: o cartão deriva do ciclo, enquanto ownership de ciclo e conta é validado contra o `user_id` persistido. A persistência de um pagamento nesse ledger, sozinha, não reduz o saldo da conta consumido pelo produto atual. A representação contábil dessa redução permanece `ACCOUNT_SETTLEMENT_REQUIRED` e `PRODUCT_DECISION_REQUIRED`.

### `card_purchase_credits`

Candidato normalizado a ledger append-only de `purchase_credit` e `credit_reversal`, com `user_id` e ligado por `transaction_id` à compra original. Não persiste `card_id` nem `billing_cycle_id`: ambos são derivados da transaction e o ownership é validado contra o `user_id` no insert. O período econômico em que o crédito neutraliza consumo e a relação entre crédito e obrigação ainda exigem decisão explícita.

### Alocações

A candidata local vincula cada pagamento diretamente a um único ciclo. O contrato anterior também propôs `card_payment_allocations`, capaz de alocar um pagamento entre ciclos/obrigações. Escolher pagamento estritamente mono-ciclo ou uma camada de alocações é `PRODUCT_DECISION_REQUIRED`; a ausência dessa decisão não pode ficar escondida na modelagem.

### Views

- `card_invoice_balances_v1`: agregação numérica crua de comprado, creditado, pago, aberto e crédito excedente; não emite lifecycle ou settlement state.
- `card_billing_shadow_comparison_v1`: compara contagem/valor legados e estruturados por usuário, cartão e mês canônico de `transaction_date`, classificando apenas cobertura `complete`, `partial` ou `unlinked`.
- não existe view de limite na candidata final. `AVIORA_MANAGED_AVAILABLE_LIMIT` permanece somente uma decisão contratual futura.

## 3. Verdade financeira e teste econômico de ouro

```text
despesa econômica = compras de cartão efetivadas
fatura = agregação da obrigação
pagamento = redução da conta + redução da obrigação, sem nova despesa
crédito/estorno = evento compensatório ligado à compra, sem apagar histórico
```

O ledger local ainda não está integrado ao saldo da conta. Evitar uma segunda transação de despesa impede uma duplicação de consumo, mas não prova que a conta foi debitada. Antes de qualquer ativação, é obrigatório passar o teste econômico de ouro por todas as camadas consumidoras:

```text
conta inicial = R$ 5.000
compra no cartão = R$ 1.000
após a compra: despesa econômica = R$ 1.000
após o pagamento: conta = R$ 4.000
após o pagamento: despesa econômica continua = R$ 1.000
Dashboard / Planejamento / Relatórios nunca exibem R$ 2.000 de consumo
```

Enquanto esse teste não existir e passar contra a implementação real, pagamento permanece não ativável.

## 4. Ciclo e competência

### Contrato fechado

- `transaction_date` permanece a competência econômica histórica.
- Nenhuma migration ou RPC recalcula ou move automaticamente `transaction_date`.
- Alterar `closing_day` ou `due_day` não move compras históricas.
- Histórico sem vínculo inequívoco permanece sem ciclo estruturado.
- A candidata não oferece calendar helper nem `attach_my_card_transaction_to_cycle_v1()`; não existe regra temporal escondida para o cliente.
- Um ciclo inserido guarda snapshots imutáveis; mudança posterior no cartão não os reescreve.

### Decisões pendentes

- compra antes, no dia e depois do fechamento;
- relação entre mês de fechamento e mês de vencimento;
- tratamento de 28/29/30/31 e fevereiro;
- timezone e instante exato do corte;
- alteração das datas do cartão e efeito somente prospectivo;
- significado de `current_date` para OPEN/CLOSED/DUE/OVERDUE.

Esses pontos foram removidos da lógica da candidata local. Nenhum mutador pode fabricá-los ou ser liberado enquanto a decisão estiver aberta.

## 5. Estados

Lifecycle e settlement state não são persistidos nem emitidos pela candidata final. `card_invoice_balances_v1` retorna apenas valores brutos.

- `OPEN`, `CLOSED`, `DUE` e `OVERDUE` só poderão ser derivados depois de contrato temporal/timezone aprovado.
- `PARTIALLY_PAID` e `PAID` só poderão ser derivados depois do contrato de pagamento/alocação e crédito.

Essa remoção evita cristalizar semântica de produto ainda aberta no banco.

## 6. Limite gerencial

Não existe fonte do emissor/banco. Qualquer resultado local é uma estimativa gerencial AVIORA e deve declarar sua cobertura.

Questões pendentes:

- valor total contratado versus parcelas materializadas;
- momento de liberação após pagamento parcial;
- tratamento de crédito, cancelamento e estorno;
- compras não estruturadas ou fora do backfill;
- limite nulo/zero;
- ajustes, taxas e parcelamento do emissor.

Não existe view de limite no schema candidato final. Uma eventual leitura futura deve usar nome/conteúdo equivalente a `AVIORA_MANAGED_AVAILABLE_LIMIT`, indicar quando a cobertura for parcial e entrar apenas após aprovação própria.

## 7. RPCs e shadow mode

| RPC candidata | Papel | Estado de ativação |
|---|---|---|
| `pay_my_card_invoice_v1` | pagamento parcial/integral mono-ciclo | bloqueada até contrato de alocação e integração da conta |
| `reverse_my_card_payment_v1` | reversão integral auditável | bloqueada junto com pagamento |
| `credit_my_card_purchase_v1` | crédito parcial/integral | bloqueada até contrato econômico do crédito |
| `reverse_my_card_purchase_credit_v1` | reversão do crédito | bloqueada junto com crédito |
| `get_my_card_billing_summary_v1` | leitura numérica crua do próprio usuário | leitura shadow; sem lifecycle, settlement ou limite |

Não existe RPC pública de criação/anexação de ciclo. As funções mutadoras de pagamento/crédito podem existir no schema local para revisão, mas a migration inicial shadow-only revoga `EXECUTE` de `PUBLIC`, `anon` e `authenticated`. Liberar cada mutador exige migration de ativação separada e explicitamente aprovada. Isso evita que uma instalação aditiva altere comportamento real antes de writer, conta e contratos estarem prontos.

## 8. Guard de transição legado → ledger

O guard da transaction diferencia duas fases para preservar compatibilidade sem enfraquecer ledger usado:

- antes de existir pagamento/crédito no ciclo: o writer legado continua podendo editar/excluir; ao mudar cartão, competência ou tipo, o vínculo estruturado é limpo, nunca recalculado;
- depois de existir ledger no ciclo: ciclo, cartão, competência, tipo e valor ficam imutáveis; a transaction não pode cruzar a fronteira de cancelamento nem ser excluída; correção exige evento compensatório explícito.

O ciclo rejeita qualquer `UPDATE`. Os ledgers validam ownership/coerência no `INSERT` e rejeitam `UPDATE`/`DELETE`. Essa proteção forte começa quando há ledger; vínculo ainda sem ledger permanece deliberadamente compatível com o runtime legado.

## 9. RLS, grants e segurança

O desenho esperado é:

- RLS ativa em todas as tabelas públicas novas;
- `anon` sem leitura ou mutação;
- `authenticated` apenas com leitura própria, e mutações somente depois de gate de ativação;
- policies de leitura baseadas em `(select auth.uid()) = user_id`;
- views com `security_invoker = true`;
- `SECURITY DEFINER` com `search_path` fixo, ownership interno e sem SQL dinâmico;
- nenhum cliente apto a fornecer `user_id` efetivo de outro usuário;
- payment deriva cartão pelo ciclo; crédito deriva cartão/ciclo pela transaction, evitando colunas redundantes e drift;
- referências de pagamento/ciclo/conta e crédito/compra coerentes no banco, não apenas na RPC;
- ledgers protegidos contra `UPDATE`/`DELETE`, inclusive diante de acesso privilegiado acidental;
- valores positivos e finitos; limite máximo/escala monetária continuam pendentes de contrato;
- idempotência por usuário/operação e reversão única.

A revisão estática não prova políticas no banco alvo. RLS, grants, spoof de `user_id`, cross-user, search-path hijack e privilégios de funções precisam ser testados em clone isolado com papéis `anon`, `authenticated` A/B e contexto real de `auth.uid()`.

## 10. Invariantes obrigatórias

1. `transaction_date` nunca é reclassificada automaticamente.
2. Uma compra vinculada pertence a um único ciclo; antes do ledger, edição estrutural limpa o vínculo sem recalcular; após ledger, não pode ser movida, cancelada, ter valor alterado ou ser excluída.
3. Ciclo é único por usuário, cartão e competência; snapshots são imutáveis e não derivam de edição posterior.
4. Compra cancelada não compõe obrigação.
5. Pagamento reduz conta e obrigação sem criar segunda despesa.
6. Pagamento não supera saldo aberto no instante serializado.
7. Crédito líquido não supera a compra e respeita o contrato econômico aprovado.
8. Original e reversão permanecem append-only; não há reversão duplicada.
9. Retry com mesma operação e payload é idempotente; payload divergente falha.
10. Conta, cartão, ciclo, pagamento, crédito e transaction sempre pertencem ao mesmo usuário.
11. Cartão do payment deriva do ciclo e cartão/ciclo do credit derivam da transaction; não existem cópias redundantes para divergir.
12. Limite gerencial não depende de DOM, `note` ou heurística textual.
13. Série parcelada nova tem identidade, total, número, cartão, usuário e competência estruturados; legado ambíguo não é inferido.
14. Dados legados permanecem intactos.
15. Eventos concorrentes preservam saldo, idempotência e unicidade.

Essas são condições de aceite. Elas só podem ser classificadas como garantidas depois de constraints/triggers e testes de runtime correspondentes; presença de SQL nominal ou teste textual não é prova suficiente.

## 11. Backfill

`BACKFILL_MODE = SAFE_NO_BACKFILL`

A candidata não associa histórico automaticamente. Isso é intencional. Não haverá heurística por `note`, descrição, valor, data próxima ou padrão textual de parcela. Um backfill futuro pode ser parcial e só associar registros com evidência inequívoca; o restante permanece nullable e explicitamente fora da cobertura estruturada.

## 12. Rollout e shadow validation

1. resolver e registrar todas as decisões de produto pendentes;
2. validar migration, rollback e drift guards em clone fiel e descartável;
3. instalar somente schema shadow, com mutadores não concedidos e sem constructor/attach público de ciclo;
4. alimentar ciclos/vínculos somente por fixture ou writer privilegiado controlado no clone;
5. comparar contagem e valor legados versus estruturados por `transaction_date`, usando `card_billing_shadow_comparison_v1`, sem mudar a UI;
6. executar fixtures sintéticas de RLS, retry, race, pagamento, crédito e reversão;
7. definir calendário/writer atômico de compra/parcela e integração do pagamento com a conta;
8. passar o teste econômico de ouro em Dashboard, Planejamento e Relatórios;
9. aprovar contratos de estados, limite gerencial e cobertura de legado;
10. liberar mutadores por migration própria;
11. só então considerar consumidor Cartões V2 e enforcement.

No shadow mode, a UI antiga continua sendo a verdade visível. O comparator expõe apenas coverage/count/amount crus; não calcula lifecycle, settlement, limite ou nova verdade financeira. Nenhuma divergência deve ser “corrigida” por backfill automático.

## 13. Rollback

### Preferencial: application-first

Depois de qualquer ativação, o rollback deve primeiro desabilitar consumidores/writers e manter schema/ledgers aditivos. Dados financeiros reais não podem ser apagados para voltar versão.

### Destrutivo, somente antes de uso/liberação

O script de remoção de schema só é admissível se:

- nenhum mutador tiver sido liberado;
- ciclos, pagamentos e créditos estiverem vazios;
- nenhuma transaction estiver vinculada;
- não houver objeto preexistente ou alheio no schema privado;
- grants estiverem revogados e writers drenados;
- locks eliminarem corrida entre o guard e o `DROP`.

Se qualquer condição falhar, o rollback deve parar fechado. Após dados reais, usar rollback application-first ou migration forward corretiva, nunca `DROP` destrutivo.

## 14. Matriz de risco revisada

| Risco | Severidade | Estado atual |
|---|---:|---|
| compra + pagamento duplicarem consumo | crítica | ABERTO; teste de ouro e integração da conta obrigatórios |
| pagamento não reduzir saldo da conta | crítica | ABERTO; `ACCOUNT_SETTLEMENT_REQUIRED` |
| regra automática de ciclo errada | crítica | ABERTO; `PRODUCT_DECISION_REQUIRED` |
| cross-user / spoof / privilege escalation | crítica | MITIGAÇÃO ESTÁTICA; runtime clone obrigatório |
| replay ou pagamento concorrente excedente | alta | MITIGAÇÃO ESTÁTICA; race/retry real obrigatório |
| crédito/reversão inconsistentes | alta | ABERTO; contrato econômico + testes obrigatórios |
| relações redundantes divergirem | alta | EXIGE INVARIANTE ESTRUTURAL |
| backfill heurístico incorreto | alta | EVITADO POR `SAFE_NO_BACKFILL`; validar ausência |
| limite apresentado como bancário | alta | ABERTO; usar conceito gerencial e aprovar fórmula |
| série parcelada incompleta | alta | ABERTO; `PRODUCT_DECISION_REQUIRED` |
| rollback apagar dados | crítica | ABERTO ATÉ GUARDS/LOCKS SEREM VALIDADOS |
| migration drift/lock | alta | PREFLIGHT E CLONE OBRIGATÓRIOS |
| mudança visual acidental | baixa | NÃO ENCONTRADA NO DIFF REVISADO |

## 15. Testes obrigatórios antes de Beta

- aplicação, rerun e drift incompatível da migration em clone;
- RLS A/B, anon, cross-user e spoof de identificadores;
- acesso direto às tabelas e ledgers;
- pagamento parcial, integral, duplicado, overpayment, retry e race;
- reversal e duplicate reversal;
- crédito parcial/integral, excesso, reversão e concorrência;
- antes/no/depois do fechamento, leap year, dias 28–31 e virada de ano, somente após decisão temporal;
- edição do cartão sem mover histórico;
- mutação/exclusão de compra já vinculada;
- dois cartões e duas contas de usuários distintos;
- série parcelada estruturada e legado ambíguo;
- rollback vazio e recusa com qualquer ciclo/dado/vínculo;
- teste econômico de ouro completo através dos consumidores financeiros.

Testes estáticos/textuais ajudam a evitar regressão de artefato, mas não substituem PostgreSQL real, pgTAP e sessões concorrentes.

## 16. Decisões de produto pendentes

1. calendário de fechamento/vencimento, boundary, timezone e edição de datas;
2. pagamento mono-ciclo versus `card_payment_allocations`;
3. representação contábil do débito da conta sem segunda despesa;
4. período econômico de créditos/estornos;
5. semântica e rótulo do limite gerencial AVIORA;
6. estrutura e retenção de séries parceladas;
7. política de retenção/exclusão de compras e cartões com ledger.

Enquanto qualquer decisão afetar contabilidade, vínculo histórico ou saldo, o gate permanece `PRODUCT_DECISION_REQUIRED`.

`BACKFILL_MODE = SAFE_NO_BACKFILL`

`VISUAL_V1_IMPACT = ZERO`
