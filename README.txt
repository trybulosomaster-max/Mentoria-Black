MENTORIA BLACK — V58 FINAL

BASE
- V56 completa como base funcional.
- Preserva Dashboard, Lançamentos, Planejamento, Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio, Relatórios e Saúde Financeira.
- Mantém a carteira própria da Reserva de Emergência criada na V56.

ALTERAÇÕES DA V58

1. CÁLCULO DA RESERVA POR GASTOS FIXOS
- Quando a meta estiver em “Por Gastos Fixos”, o valor mensal de referência passa a ser a média dos 6 meses completos anteriores ao período selecionado.
- O mês selecionado NÃO entra no cálculo.
- Exemplo: selecionando Outubro/2026, a média considera Abril, Maio, Junho, Julho, Agosto e Setembro/2026.
- Isso evita que um mês ainda em andamento, com lançamentos incompletos, reduza artificialmente ou distorça a meta.
- O cálculo continua considerando tudo que estiver classificado como “Gastos Fixos”, inclusive gastos essenciais que o usuário tenha colocado nessa categoria, como alimentação e gasolina.
- A meta continua sendo: média mensal de Gastos Fixos × quantidade de meses definida pelo usuário.

2. VALOR PERSONALIZADO
- “Valor personalizado” continua independente dos Gastos Fixos.
- O valor definido pelo usuário não é substituído pela média.
- A equivalência em meses continua sendo exibida apenas como referência.

3. RESERVA DE EMERGÊNCIA
- A carteira própria de Reserva da V56 permanece como fonte oficial do saldo.
- Aportes e retiradas continuam sendo lançamentos próprios.
- O saldo não é tratado como despesa, receita ou investimento comum.

4. DASHBOARD
- Mantém o KPI “Reserva de Emergência”, alimentado pelo saldo real da carteira da Reserva.
- Remove da Dashboard os blocos completos de Reserva de Emergência e Saúde Financeira, evitando repetição.
- As análises completas continuam disponíveis nas respectivas abas.

5. SAÚDE FINANCEIRA
- O indicador de Reserva passa a usar exatamente a mesma média de 6 meses completos usada pela Reserva.
- A página independente de Saúde Financeira continua preservada.
- A nota geral continua usando os demais componentes da metodologia, mas a parcela da Reserva utiliza a nova base.

6. SEGURANÇA E COMPATIBILIDADE
- Nenhum schema do Supabase é alterado.
- Nenhum lançamento antigo é apagado.
- A migração da antiga Meta de Reserva da V56 continua protegida contra duplicação.
- A V58 altera somente a lógica de cálculo e a apresentação descritas acima.

TESTE RECOMENDADO

1. Selecione Outubro/2026 na Reserva.
2. Confirme que “Gastos Fixos” representa a média de Abril a Setembro/2026.
3. Lance um gasto fixo em Outubro e confirme que a média da Reserva não muda por causa desse lançamento.
4. Altere o mês para Setembro/2026 e confirme que a base passa a considerar Março a Agosto/2026.
5. Teste “Valor personalizado” e confirme que a meta definida manualmente permanece intacta.
6. Confirme que a Reserva atual continua sendo o saldo dos lançamentos próprios da Reserva.
7. Vá à Dashboard e confirme que permanece o KPI da Reserva, mas não os blocos completos de Reserva/Saúde.
8. Vá à Saúde Financeira e confirme que o indicador de Reserva acompanha a mesma base de 6 meses completos.

IMPORTANTE
A V58 é uma versão completa. Substitua os três arquivos da versão anterior pelos três arquivos desta pasta.
