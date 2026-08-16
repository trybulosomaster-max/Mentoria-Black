MENTORIA BLACK — V70 ESCUDO FINAL

BASE
- V69 consolidada.
- Nenhum dado ou schema do Supabase é alterado.
- Manifesto existente deve ser mantido.

CORREÇÃO V70 — EVOLUÇÃO DAS RECEITAS
- Uma única função canônica revenueYear().
- Uma única função canônica drawRevenue().
- Aceita transaction_date, date, created_at e billing_date como fonte de data.
- Aceita datas ISO (YYYY-MM-DD) e DD/MM/YYYY.
- Usa transaction_type ou type para identificar Receita.
- Registros cancelados são excluídos.
- Valores não positivos não entram como receita recebida.
- O ano da evolução é independente do mês selecionado.
- O total anual e o gráfico usam exatamente a mesma função.
- O gráfico usa Chart.js sobre um único canvas dedicado.
- O card usa um único ID: v70RevenueYear.
- Não são adicionados wrappers antigos de drawCharts.
- A integração é protegida contra execução duplicada com __MB_V70_REVENUE__.

REGRA FINANCEIRA
- Receita realizada representa dinheiro efetivamente recebido.
- Receita pendente/futura deve continuar disponível para previsibilidade/planejamento.
- Não misturar realizado e projetado no mesmo indicador sem identificação explícita.

ESCUDO
- Antes de cada nova versão: procurar funções duplicadas, wrappers antigos,
  reatribuições de window.dashboard/render/drawCharts, IDs duplicados e cálculos
  divergentes para a mesma métrica.
- Não alterar regra financeira para corrigir problema visual.
- Não alterar visual para mascarar erro de dados.
- Não apagar/recriar transações.
- Não alterar schema/migração do Supabase sem solicitação explícita.
- Toda métrica financeira deve possuir uma definição canônica.

ARQUIVOS OFICIAIS
- index.html
- sw.js
- README.txt

TESTE OBRIGATÓRIO
1. Dashboard.
2. Outubro/2026.
3. Confirmar que receitas reais aparecem.
4. Confirmar Janeiro–Dezembro.
5. Confirmar que despesas/investimentos não entram na evolução.
6. Confirmar que canceladas não entram.
7. Recarregar completamente e verificar cache.
8. Conferir Investimentos e Despesas por categoria.
9. Conferir categorias e ausência do alias Liberdade Financeira.
10. Conferir que nenhum dado do Supabase foi alterado.
