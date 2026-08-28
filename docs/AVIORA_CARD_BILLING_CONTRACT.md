# AVIORA — Contrato de fatura e pagamento de cartões

## Decisão do gate

`CONTRACT_GATE = PRODUCT_DECISION_REQUIRED`

`CARD_BILLING_BETA_READINESS = HOLD`

`INITIAL_SCHEMA_MODE = SHADOW_ONLY`

`REMOTE_APPLY = PROHIBITED_PENDING_PRODUCT_DECISIONS_AND_RUNTIME_VALIDATION`

Classificação da fatura completa: `PERSISTED_INVOICE_REQUIRED`.

Classificações complementares:

- competência já registrada: `DERIVED_INVOICE_SAFE`, exclusivamente para agrupar compras por `card_id + transaction_date`;
- pagamento: `ACCOUNT_SETTLEMENT_REQUIRED` e `CARD_PAYMENT_CONTRACT_REQUIRED`;
- alocação: `SINGLE_CYCLE_VS_ALLOCATIONS_PRODUCT_DECISION_REQUIRED`;
- limite disponível: `AVIORA_MANAGED_LIMIT_CONTRACT_REQUIRED`;
- séries parceladas criadas pelo frontend: `STRUCTURED_INSTALLMENT_SERIES_REQUIRED`;
- estorno de compra no cartão: `CARD_REVERSAL_CONTRACT_REQUIRED`;
- período econômico de crédito/estorno: `PRODUCT_DECISION_REQUIRED`;
- retenção de compras/cartões com ledger: `PRODUCT_DECISION_REQUIRED`.

A interface pode continuar mostrando o gasto/compromisso de uma competência, mas não pode chamar esse agregado de fatura aberta, fechada, paga ou saldo devedor. Também não pode declarar limite bancário utilizado/disponível real. Os artefatos locais de backend são candidatos não aplicados e devem permanecer em shadow mode, sem grants mutadores para `authenticated`, até estas decisões e a validação de runtime serem concluídas.

## 1. Conceitos e fontes de verdade

### Cartão

`public.cards` guarda `name`, `institution`, `brand`, `limit`, `closing_day`, `due_day` e `note`. Não guarda saldo utilizado, saldo disponível ou estado da fatura.

### Compra no cartão

É um registro de `public.transactions` com `card_id` e tipo econômico `despesa` (ou um caso legado de investimento). As datas têm papéis diferentes:

- `purchase_date`: data da compra; não define período financeiro;
- `transaction_date`: competência/data de fatura confirmada pelo usuário; é a fonte canônica de Dashboard, Lançamentos, Planejamento, Relatórios e Cartões.

O estado temporal canônico vem de `status + transaction_date`: realizado, programado/materializado, cancelado ou não classificado.

### Visão mensal existente

O agrupamento `card_id + mês(transaction_date)` é derivado com segurança. Ele representa compras e compromissos atribuídos à competência, não uma fatura liquidável.

### Fatura liquidável

É o conjunto versionado de obrigações de um ciclo, com fechamento, vencimento, saldo original, pagamentos/alocações, créditos e saldo aberto. Esse contrato não existe no schema atual.

## 2. Ciclo e competência

### Regra vigente

A competência vigente é sempre a `transaction_date` persistida. `purchase_date`, `closing_day` e `due_day` não podem reclassificar silenciosamente uma compra existente.

Consequências:

- compra antes do fechamento: entra na fatura informada em `transaction_date`;
- compra no dia do fechamento: entra na fatura informada em `transaction_date`;
- compra depois do fechamento: entra na fatura informada em `transaction_date`;
- parcela: cada registro entra exatamente na competência da própria `transaction_date`.

Essa formulação parece repetitiva porque o produto já permite confirmação manual. Ela evita declarar uma convenção automática ainda não aprovada.

### Helper legado não canônico

`v19SuggestedBillingDate()` sugere:

- compra em dia menor ou igual a `closing_day`: vencimento um mês depois;
- compra após `closing_day`: vencimento dois meses depois.

Para fechamento 22 e vencimento 30, por exemplo, 20/08 sugere 30/09 e 23/08 sugere 30/10. Fixtures anteriores também representam compra de 20/08 na competência 30/08. Portanto existe divergência objetiva. A sugestão continua editável, mas não é contrato financeiro e não será usada para recalcular histórico.

`CYCLE_CALENDAR = PRODUCT_DECISION_REQUIRED`

Decisão necessária para automatizar o ciclo:

1. o dia do fechamento pertence à fatura que fecha ou à seguinte;
2. relação entre mês de fechamento e mês de vencimento;
3. tratamento de dias inexistentes (28–31);
4. fuso/instante exato do fechamento;
5. efeito de alterar `closing_day` ou `due_day` em ciclos futuros e históricos.

Até a decisão explícita, nenhuma função pode tratar uma convenção de mês anterior, boundary inclusivo, `current_date` da sessão ou clamp para fim de mês como regra aprovada. Código local que experimente uma dessas opções é provisório, fica inacessível ao cliente e não autoriza backfill, writer ou ativação.

A candidata final removeu os helpers de calendário e a RPC de attach. Ciclos recebem snapshots explícitos por um futuro writer privilegiado e rejeitam `UPDATE`; portanto o schema não esconde uma escolha temporal não aprovada.

## 3. Parcelamento

O banco oferece `installment_series_id` e `installment_number`, com unicidade por usuário/série/parcela. O frontend atual, porém, cria parcelas sem preencher esses campos e registra `Parcelado X/Y` em `note`.

Contrato seguro atual:

- cada parcela materializada é uma transação econômica independente;
- cada parcela pertence somente ao mês de sua `transaction_date`;
- uma ocorrência materializada substitui a projeção virtual equivalente;
- compromissos futuros exibem apenas registros persistidos/projeções canônicas;
- agrupamento textual legado pode explicar a UI, mas não autoriza liquidação, exclusão ampla ou cálculo de limite.

Para gestão completa, a série precisa guardar identidade estruturada, total de parcelas, número da parcela, cartão, usuário, competências e vínculo imutável. Retenção/exclusão da série e de cartões com obrigações também precisa de contrato. Não é seguro fabricar série por descrição, valor ou data.

## 4. Contabilidade econômica

### Compra

A compra representa a despesa econômica. Quando efetivada, afeta `Realizado`; quando pendente ou futura, afeta `Programado`; recorrência ainda não materializada afeta `Projetado`; `Previsão = Programado + Projetado`.

### Fatura

A fatura é agregação da obrigação. Não é nova despesa econômica.

### Pagamento

O pagamento é liquidação patrimonial da obrigação, não uma segunda despesa. O invariante obrigatório é:

```text
compra econômica R$ 100
+ liquidação da fatura R$ 100
= despesa de consumo R$ 100, nunca R$ 200
```

Uma futura liquidação precisa debitar a conta escolhida e reduzir a obrigação do cartão sem alimentar novamente `consumptionExpenseAmount`. O motor atual consegue representar neutralidade econômica em transferências estruturadas, mas cartões não são contas e não existe passivo/clearing ou alocação de fatura que torne essa operação válida hoje.

`ACCOUNT_SETTLEMENT_REQUIRED`: o ledger candidato de pagamentos não é consumido hoje pelo cálculo de saldo da conta. Inserir apenas a linha de pagamento no ledger poderia marcar a obrigação como paga sem reduzir a conta visível. Antes de qualquer grant mutador, o produto deve escolher e aprovar a representação contábil da saída de caixa, com auditabilidade e sem criar uma segunda despesa.

Teste econômico de ouro obrigatório:

```text
conta inicial = R$ 5.000
compra no cartão = R$ 1.000
após a compra: despesa econômica = R$ 1.000
após pagar a fatura: conta = R$ 4.000
após pagar a fatura: despesa econômica continua = R$ 1.000
Dashboard / Planejamento / Relatórios nunca mostram R$ 2.000
```

Um teste que apenas verifica “nenhuma segunda despesa foi inserida” não prova esse contrato; também precisa provar a redução da conta e a verdade compartilhada pelos consumidores financeiros.

## 5. Pagamento da fatura — respostas do estado atual

| Pergunta | Resposta comprovada |
|---|---|
| A. É criada uma transação ao pagar a fatura? | Não existe pagamento agregado. |
| B. Altera status das compras? | O botão `Pagar` atual altera apenas uma transação de `pendente` para `realizado`; não quita fatura. |
| C. Existe transferência? | Não. |
| D. Reduz saldo de conta? | Não no fluxo de cartão atual. |
| E. Evita dupla contabilização? | Só porque nenhuma liquidação é registrada; criar outra despesa duplicaria. |
| F. Como aparece em Lançamentos? | Apenas a compra individual muda para `Realizado`. |
| G. Como aparece no Dashboard? | A mesma compra migra de Programado para Realizado, mantendo o Esperado uma vez. |
| H. Como aparece no Planejamento? | A mesma ocorrência migra de Programado para Realizado, sem criar segunda saída. |

O texto `Pagar` significa hoje “marcar lançamento individual como realizado”. Ele não deve ser reutilizado como “pagar fatura”.

### Candidata local de pagamento

O artefato backend local modela hoje um pagamento diretamente contra um único ciclo. Isso ainda não fecha o contrato de alocação. É necessária uma decisão explícita entre:

1. pagamento estritamente mono-ciclo, com o banco proibindo qualquer uso multi-ciclo; ou
2. `card_payment_allocations`, separando o evento de caixa das alocações entre ciclos/obrigações.

Pagamento parcial, retry e reversão só podem ser considerados seguros depois de testes em PostgreSQL real com sessões concorrentes. Até lá, as RPCs mutadoras permanecem sem `EXECUTE` para clientes autenticados.

## 6. Estados da fatura

Estados conceituais propostos, ainda `PRODUCT_DECISION_REQUIRED`:

| Estado técnico | Rótulo sugerido | Condição necessária |
|---|---|---|
| `OPEN` | Aberta | ciclo ainda recebe compras; saldo aberto maior que zero |
| `CLOSED` | Fechada | fechamento ocorreu, vencimento não ocorreu e saldo aberto maior que zero |
| `DUE` | Vence hoje | data atual igual ao vencimento e saldo aberto maior que zero |
| `PARTIALLY_PAID` | Parcialmente paga | pagamentos alocados maiores que zero e menores que o saldo exigível |
| `PAID` | Paga | saldo exigível igual a zero, com liquidação auditável |
| `OVERDUE` | Vencida | vencimento passou e saldo aberto é maior que zero |

Datas sozinhas não provam `PARTIALLY_PAID` ou `PAID`. Esses estados não serão inferidos de `status` das compras. Um crédito parcial também precisa aparecer como cobertura parcial da obrigação, mesmo sem pagamento; classificá-lo simplesmente como `unpaid` seria enganoso. OPEN/CLOSED/DUE/OVERDUE dependem ainda do timezone aprovado para a data corrente.

A migration candidata final não persiste nem emite lifecycle/settlement state. `card_invoice_balances_v1` entrega somente valores brutos, evitando transformar esta tabela conceitual em contrato por acidente.

## 7. Limite utilizado e disponível

Não há fórmula canônica aplicável ao schema atual nem fonte oficial do emissor.

Questões ainda sem fonte de verdade:

- o limite é comprometido pelo valor total contratado no ato ou só por parcelas materializadas;
- pagamento parcial libera limite proporcionalmente e em qual instante;
- crédito/estorno libera o limite antes de ser compensado na fatura;
- compras pendentes de autorização comprometem limite;
- como tratar ajuste manual, taxas e parcelamento pelo emissor.

Fórmula futura, condicionada à aprovação:

```text
limite disponível = limite cadastrado - compromissos de limite em aberto
```

`compromissos de limite em aberto` precisa vir de eventos persistidos de compra, pagamento alocado, cancelamento e estorno. Somar apenas a fatura atual ou todas as `transactions` futuras seria uma estimativa e não pode ser exibida como saldo real.

Se uma estimativa local for aprovada, seu contrato e rótulo devem declarar `AVIORA_MANAGED_AVAILABLE_LIMIT`, ou equivalente, além do grau de cobertura (`structured_only`, parcial ou completo). Ela não pode ser apresentada como limite bancário oficial. A fórmula, o efeito de créditos/pagamentos e o tratamento de legado permanecem `PRODUCT_DECISION_REQUIRED`.

A candidata final não contém view de limite. O único comparator shadow mede cobertura estruturada por contagem e valor; não calcula disponibilidade.

## 8. Cancelamento e estorno

### Cancelamento

O contrato atual usa `status = cancelado`. A transação deixa Realizado, Programado, Projetado/Previsão, fatura derivada e compromissos exibidos. O histórico do registro permanece, salvo exclusão explícita do usuário.

### Estorno

Estorno após efetivação precisa ser um evento compensatório auditável, ligado à compra original. Deve:

- neutralizar a despesa no período definido pelo contrato;
- reduzir a obrigação/fatura ou gerar crédito;
- liberar limite conforme a regra aprovada;
- preservar compra e estorno no histórico.

O período econômico da compensação não está decidido: data do crédito, competência da compra original ou outra regra podem produzir resultados mensais diferentes. Essa escolha afeta Dashboard, Planejamento e Relatórios e permanece `PRODUCT_DECISION_REQUIRED`; a RPC local não pode decidir isso implicitamente.

`reversal_of_id` e `reverse_structured_operation_v82()` existem apenas para transferência, investimento e resgate. A RPC rejeita despesa de cartão. Logo não há estorno canônico de cartão.

Cancelar uma compra histórica não é equivalente a registrar um estorno.

## 9. Artefatos persistentes locais, ainda não aplicados

Existe uma candidata local de migration para revisão. Ela não foi aplicada e não representa contrato funcional aprovado. O estado aceitável inicial é `SHADOW_ONLY`, com mutadores inacessíveis a `authenticated`.

Modelo-alvo em revisão:

1. `card_billing_cycles`: usuário, cartão, chave do ciclo e snapshots imutáveis de início/fechamento/vencimento; nenhum estado operacional persistido;
2. vínculo de cada compra/parcela ao ciclo persistido, sem reclassificação por alteração posterior do cartão;
3. `card_invoice_payments`: ciclo, conta de origem, valor, data, idempotência e reversão; o cartão deriva do ciclo, sem `card_id` redundante;
4. `card_payment_allocations`, ou proibição estrutural explícita de multi-ciclo, conforme decisão pendente;
5. `card_purchase_credits`: crédito/estorno vinculado apenas à compra original; cartão e ciclo derivam da transaction, sem cópia redundante;
6. RPC transacional para pagar/alocar e RPC própria para estornar;
7. RLS por `auth.uid()`, FKs compostas por usuário, índices de ciclo e chaves de idempotência.

Alternativas são possíveis, mas precisam provar pagamento parcial, histórico, concorrência, retry, redução da conta e zero dupla contabilização. Uma coluna booleana `invoice_paid` não é suficiente.

O schema deriva relações em vez de persistir cópias que possam divergir: payment → ciclo → cartão; credit → transaction → ciclo/cartão. Triggers validam ownership/coerência no insert e tornam ledgers append-only mesmo diante de um writer privilegiado acidental. Ciclos rejeitam update.

O guard da transaction é compatível com o legado antes de existir ledger: edição estrutural limpa `card_billing_cycle_id` sem tocar em `transaction_date`, e delete continua possível. Depois que o ciclo possui pagamento ou crédito, ciclo/cartão/competência/tipo/valor e a fronteira de cancelamento ficam protegidos, e delete falha; correções exigem evento compensatório.

## 10. Edge cases

- `closing_day`/`due_day` nulos: apenas competência manual; nenhum estado de ciclo automático;
- `limit` nulo ou zero: limite desconhecido, nunca disponibilidade zero inferida;
- limite excedido: gasto pode ser mostrado, mas o sistema não inventa bloqueio bancário;
- dois cartões: agregados e ciclos permanecem separados por `card_id`;
- cartão sem movimentação: gasto da competência zero; fatura/limite disponível continuam não declarados;
- virada de ano: a `transaction_date` de cada parcela determina dezembro/janeiro sem duplicação;
- alteração de fechamento: não move transações históricas;
- recorrência em cartão: `next_date` materializada continua competência explícita; não existe helper de ciclo automático na candidata;
- conta e cartão no mesmo legado: não autoriza debitar a conta; requer reconciliação explícita;
- pagamento maior, menor ou duplicado: precisa falhar/ser idempotente no backend futuro;
- compra/cartão com ciclo, pagamento ou crédito: exclusão e retenção exigem política aprovada, sem `DROP`/cascade destrutivo;
- a candidata rejeita timestamps infinitos e valores não positivos/não finitos; limite máximo e escala monetária ainda precisam de contrato antes da ativação.

## 11. Invariantes

As regras abaixo são condições de aceite do contrato, não garantias já provadas pela candidata local:

1. Nenhuma compra aparece em duas competências/faturas.
2. Nenhuma parcela aparece duas vezes.
3. Materialização substitui projeção equivalente.
4. Pagamento não duplica despesa econômica.
5. Cancelamento não permanece nos agregados.
6. Estorno é explícito e não apaga a compra original.
7. Soma das parcelas futuras é reproduzível a partir de identidades persistidas.
8. Limite nunca depende de DOM, texto de `note` ou mês selecionado.
9. Dashboard, Lançamentos, Planejamento e Cartões usam `transaction_date` como competência.
10. Mudanças em fechamento/vencimento não reescrevem histórico.
11. Pagamentos e estornos são idempotentes e seguros sob concorrência.
12. Nenhum estado `PAID` é inferido apenas pela passagem do tempo ou pelo status individual das compras.

## 12. Exemplos numéricos

### Compra simples

- compra: R$ 100 em 20/08;
- competência confirmada: 30/09;
- agosto: R$ 0 desse registro;
- setembro: R$ 100 uma vez.

Não é permitido recalcular a competência ao editar `closing_day`.

### Parcelamento

- compra: R$ 900 em 20/11;
- três parcelas persistidas: R$ 300 em 30/12, 30/01 e 28/02;
- cada mês recebe R$ 300;
- compromisso futuro em dezembro soma janeiro + fevereiro = R$ 600;
- o limite comprometido real permanece indeterminado até o contrato de liquidação.

### Pagamento integral

- compras econômicas da competência: R$ 1.000;
- pagamento: R$ 1.000;
- despesa econômica: R$ 1.000;
- obrigação aberta: R$ 0 somente se a alocação persistida for confirmada.

### Pagamento parcial

- saldo exigível: R$ 1.000;
- pagamento alocado: R$ 400;
- saldo aberto: R$ 600;
- estado: `PARTIALLY_PAID`;
- despesa econômica continua R$ 1.000.

O schema da aplicação atual não representa essas liquidações, e a candidata local mono-ciclo ainda não resolve a decisão geral de alocação nem o débito da conta.

## 13. Backfill

`BACKFILL_MODE = SAFE_NO_BACKFILL`

A migration candidata não deve preencher `card_billing_cycle_id` no histórico. Não é permitido inferir série, ciclo ou obrigação por `note`, descrição, valor, data próxima ou semelhança textual. Um backfill futuro pode ser `PARTIAL_BACKFILL` somente para evidência inequívoca e explicitamente aprovada; registros ambíguos permanecem sem estrutura.

## 14. Shadow mode e ativação

O primeiro estágio aceitável mantém a aplicação atual como verdade visível:

```text
schema candidato calcula em isolamento
UI e motores atuais continuam canônicos
comparação crua mede count/amount legado versus estruturado por transaction_date
nenhuma RPC mutadora é concedida ao cliente
```

Não existe RPC de attach ou helper de calendário. As RPCs de pagamento, crédito e reversão ficam sem `EXECUTE` para `authenticated`. Eventual grant exige migration própria, depois de decisões de produto, writer integrado, teste econômico de ouro e validação de RLS/concorrência.

`card_billing_shadow_comparison_v1` expõe somente `legacy_count`, `legacy_amount`, `structured_count`, `structured_amount` e cobertura `complete`/`partial`/`unlinked` por usuário/cartão/mês canônico. Não produz lifecycle, settlement state, limite ou uma nova verdade financeira.

## 15. Rollout, rollback e validação obrigatória

### Rollout

1. fechar decisões de produto;
2. aplicar migration em clone fiel e descartável;
3. testar drift, rerun, RLS, grants e funções;
4. validar shadow sem alterar UI;
5. implementar integração contábil e writer em gate separado;
6. passar regressão financeira e o teste econômico de ouro;
7. liberar mutadores por migration explicitamente autorizada.

### Rollback

Após qualquer uso real, rollback é application-first: desabilitar consumidor/writer e preservar schema/ledgers. Um rollback destrutivo só é admissível antes de liberação e quando ciclos, pagamentos, créditos e vínculos estiverem todos vazios, sem objeto privado preexistente/alheio e com locks que eliminem corrida entre guard e `DROP`. Caso contrário deve falhar fechado.

### Runtime clone obrigatório

- RLS anon, autenticado A/B, cross-user e spoof de identificadores;
- grants diretos e `SECURITY DEFINER` com `search_path` fixo;
- pagamento parcial/integral, overpayment, retry, replay e concorrência real;
- crédito, reversão e duplicate reversal;
- alteração/exclusão de compra vinculada;
- dois cartões, duas contas e dois usuários;
- migration drift/rerun e rollback vazio/não vazio;
- boundaries temporais após aprovação da regra;
- teste econômico de ouro completo nos consumidores.

Testes estáticos/textuais não substituem PostgreSQL real, pgTAP e múltiplas sessões concorrentes.

## 16. Registro de decisões pendentes

| Tema | Estado | Decisão necessária |
|---|---|---|
| fechamento e vencimento | `PRODUCT_DECISION_REQUIRED` | boundary, relação mensal, 28–31, timezone e edição do cartão |
| pagamento | `ACCOUNT_SETTLEMENT_REQUIRED` | como debitar conta e obrigação sem segunda despesa |
| alocação | `PRODUCT_DECISION_REQUIRED` | mono-ciclo estrito ou `card_payment_allocations` |
| crédito/estorno | `PRODUCT_DECISION_REQUIRED` | período econômico e efeito na obrigação/limite |
| limite | `PRODUCT_DECISION_REQUIRED` | fórmula e rótulo de limite gerencial, cobertura de legado |
| parcelas | `PRODUCT_DECISION_REQUIRED` | entidade/total/card/competências e retenção |
| exclusão/retenção | `PRODUCT_DECISION_REQUIRED` | compras, cartões, ciclos e ledgers após uso |

## 17. Resultado funcional desta revisão

Os artefatos locais foram reclassificados como desenho shadow-only sujeito a decisões de produto e validação de runtime. Nenhuma função de fatura foi ativada, nenhuma migration foi aplicada e nenhum botão, saldo, limite, alerta ou estado de ciclo foi publicado. O Visual V1 e todos os motores financeiros permanecem congelados.

Gates mantidos fora de escopo:

- `HEALTH_V2_CONTRACT_REVIEW_REQUIRED`;
- `RESERVE_CROSS_DEVICE_BACKEND_GATE`.

`CARD_BILLING_BETA_READINESS = HOLD`
