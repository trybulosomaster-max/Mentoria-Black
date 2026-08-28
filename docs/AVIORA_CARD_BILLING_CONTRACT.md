# AVIORA — Contrato de fatura e pagamento de cartões

## Decisão do gate

`CONTRACT_GATE = REVIEW_REQUIRED`

Classificação da fatura completa: `PERSISTED_INVOICE_REQUIRED`.

Classificações complementares:

- competência já registrada: `DERIVED_INVOICE_SAFE`, exclusivamente para agrupar compras por `card_id + transaction_date`;
- pagamento: `CARD_PAYMENT_CONTRACT_REQUIRED`;
- limite disponível: `BACKEND_REQUIRED`;
- séries parceladas criadas pelo frontend: `STRUCTURED_INSTALLMENT_SERIES_REQUIRED`;
- estorno de compra no cartão: `CARD_REVERSAL_CONTRACT_REQUIRED`.

A interface pode continuar mostrando o gasto/compromisso de uma competência, mas não pode chamar esse agregado de fatura aberta, fechada, paga ou saldo devedor. Também não pode declarar limite utilizado/disponível real. Resolver esses pontos exige persistência, operação transacional, RLS e uma decisão de produto sobre o ciclo; por isso a implementação funcional nova para Cartões para neste documento.

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

Decisão necessária para automatizar o ciclo:

1. o dia do fechamento pertence à fatura que fecha ou à seguinte;
2. relação entre mês de fechamento e mês de vencimento;
3. tratamento de dias inexistentes (28–31);
4. fuso/instante exato do fechamento;
5. efeito de alterar `closing_day` ou `due_day` em ciclos futuros e históricos.

## 3. Parcelamento

O banco oferece `installment_series_id` e `installment_number`, com unicidade por usuário/série/parcela. O frontend atual, porém, cria parcelas sem preencher esses campos e registra `Parcelado X/Y` em `note`.

Contrato seguro atual:

- cada parcela materializada é uma transação econômica independente;
- cada parcela pertence somente ao mês de sua `transaction_date`;
- uma ocorrência materializada substitui a projeção virtual equivalente;
- compromissos futuros exibem apenas registros persistidos/projeções canônicas;
- agrupamento textual legado pode explicar a UI, mas não autoriza liquidação, exclusão ampla ou cálculo de limite.

Para gestão completa, a série precisa guardar identidade estruturada, total de parcelas, número da parcela e vínculo imutável. Não é seguro fabricar série por descrição, valor ou data.

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

## 6. Estados da fatura

Estados técnicos propostos, ainda `BACKEND_REQUIRED`:

| Estado técnico | Rótulo sugerido | Condição necessária |
|---|---|---|
| `OPEN` | Aberta | ciclo ainda recebe compras; saldo aberto maior que zero |
| `CLOSED` | Fechada | fechamento ocorreu, vencimento não ocorreu e saldo aberto maior que zero |
| `DUE` | Vence hoje | data atual igual ao vencimento e saldo aberto maior que zero |
| `PARTIALLY_PAID` | Parcialmente paga | pagamentos alocados maiores que zero e menores que o saldo exigível |
| `PAID` | Paga | saldo exigível igual a zero, com liquidação auditável |
| `OVERDUE` | Vencida | vencimento passou e saldo aberto é maior que zero |

Datas sozinhas não provam `PARTIALLY_PAID` ou `PAID`. Esses estados não serão inferidos de `status` das compras.

## 7. Limite utilizado e disponível

Não há fórmula canônica aplicável ao schema atual.

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

## 8. Cancelamento e estorno

### Cancelamento

O contrato atual usa `status = cancelado`. A transação deixa Realizado, Programado, Projetado/Previsão, fatura derivada e compromissos exibidos. O histórico do registro permanece, salvo exclusão explícita do usuário.

### Estorno

Estorno após efetivação precisa ser um evento compensatório auditável, ligado à compra original. Deve:

- neutralizar a despesa no período definido pelo contrato;
- reduzir a obrigação/fatura ou gerar crédito;
- liberar limite conforme a regra aprovada;
- preservar compra e estorno no histórico.

`reversal_of_id` e `reverse_structured_operation_v82()` existem apenas para transferência, investimento e resgate. A RPC rejeita despesa de cartão. Logo não há estorno canônico de cartão.

Cancelar uma compra histórica não é equivalente a registrar um estorno.

## 9. Entidade persistida proposta

Proposta para gate backend separado, sem migration nesta execução:

1. `card_billing_cycles`: usuário, cartão, chave do ciclo, fechamento e vencimento congelados, estado operacional e timestamps;
2. vínculo de cada compra/parcela ao ciclo persistido, sem reclassificação por alteração posterior do cartão;
3. `card_payments`: usuário, cartão, ciclo, conta de origem, valor, data, idempotência e estado;
4. `card_payment_allocations`: alocação auditável do pagamento ao ciclo/obrigações;
5. créditos/estornos vinculados à compra original;
6. RPC transacional para pagar/alocar e RPC própria para estornar;
7. RLS por `auth.uid()`, FKs compostas por usuário, índices de ciclo e chaves de idempotência.

Alternativas são possíveis, mas precisam provar pagamento parcial, histórico, concorrência, retry e zero dupla contabilização. Uma coluna booleana `invoice_paid` não é suficiente.

## 10. Edge cases

- `closing_day`/`due_day` nulos: apenas competência manual; nenhum estado de ciclo automático;
- `limit` nulo ou zero: limite desconhecido, nunca disponibilidade zero inferida;
- limite excedido: gasto pode ser mostrado, mas o sistema não inventa bloqueio bancário;
- dois cartões: agregados e ciclos permanecem separados por `card_id`;
- cartão sem movimentação: gasto da competência zero; fatura/limite disponível continuam não declarados;
- virada de ano: a `transaction_date` de cada parcela determina dezembro/janeiro sem duplicação;
- alteração de fechamento: não move transações históricas;
- recorrência em cartão: `next_date` materializada continua competência explícita; não passa automaticamente pelo helper de ciclo;
- conta e cartão no mesmo legado: não autoriza debitar a conta; requer reconciliação explícita;
- pagamento maior, menor ou duplicado: precisa falhar/ser idempotente no backend futuro.

## 11. Invariantes

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

O schema atual não consegue provar essas duas alocações.

## 13. Resultado funcional desta execução

Implementado apenas o guard de contrato na camada de dados da tela. Ele expõe explicitamente `REVIEW_REQUIRED`/`BACKEND_REQUIRED` e impede que futuras alterações tratem gasto mensal como fatura ou disponibilidade real por engano.

Nenhum botão de pagar fatura, saldo de fatura, limite disponível, alerta de vencimento ou estado de ciclo foi adicionado. O Visual V1 e todos os motores financeiros permanecem congelados.

Gates mantidos fora de escopo:

- `HEALTH_V2_CONTRACT_REVIEW_REQUIRED`;
- `RESERVE_CROSS_DEVICE_BACKEND_GATE`.
