MENTORIA BLACK — V64 FINAL

BASE
- V60 FINAL funcional preservada como base.
- Mantém Supabase, autenticação, Cartões, Categorias, Metas, Recorrências, Patrimônio, Reserva, Saúde Financeira, Receitas, Investimentos, Parcelados e Relatórios.
- Sem alteração de schema/migração do Supabase.

CORREÇÃO V64 — CATEGORIAS DINÂMICAS NO DASHBOARD
1. O gráfico “Despesas por categoria” deixa de depender de nomes de categorias fixados no código.
2. O gráfico prioriza o nome atual da categoria cadastrado em DATA.categories.
3. A resolução suporta categorias vinculadas por category_id/categoryId, objetos de categoria e nomes atuais.
4. O nome dinâmico é aplicado às barras e ao tooltip, preservando valor e percentual.
5. A regra vale para todas as categorias atuais e futuras.
6. “Investimentos” deve aparecer no lugar de “Liberdade Financeira” quando a transação estiver vinculada à categoria atualmente cadastrada como Investimentos.
7. Não altera valores, percentuais, datas, transações ou cálculos financeiros.

CORREÇÕES V63 PRESERVADAS
- Dashboard mantém seleção de mês e ano.
- Atualizar e Sair permanecem funcionais.
- PDF/Imprimir fica oculto somente na Dashboard.
- Resumo da Reserva de Emergência e Patrimônio permanece na Dashboard.
- Despesas por categoria inclui Investimentos como saída financeira.
- Cores cadastradas são preservadas.
- Tooltip mostra valor + percentual.
- Aba Categorias e aba Cartões são preservadas.
- Resumo operacional dos lançamentos permanece sincronizado com o período.
- Módulos de Metas, Recorrências, Parcelados, Receitas, Investimentos, Reserva, Saúde e Relatórios permanecem na base V60.

VALIDAÇÃO
- Confirmar que “Investimentos” aparece no gráfico.
- Confirmar que o tooltip também mostra “Investimentos”.
- Renomear outra categoria no cadastro e verificar a atualização automática quando a transação estiver vinculada à categoria.
- Confirmar que valores e percentuais permanecem iguais.
- Confirmar que não existem nomes de categorias hardcoded no componente corrigido.

ARQUIVOS
- index.html
- sw.js
- README.txt
Sem manifest.json e sem quarto arquivo.
