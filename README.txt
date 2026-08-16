MENTORIA BLACK — V64.1 FINAL

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


CORREÇÃO V65 — DASHBOARD
- Removido da Dashboard o card/acesso rápido de “Saúde Financeira”.
- A página/aba própria de Saúde Financeira permanece disponível.
- A funcionalidade interna da Saúde Financeira não foi removida.
- A alteração remove somente o bloco de Saúde Financeira que estava sendo inserido dentro da Dashboard.


CORREÇÃO V64.1
- Removido da Dashboard o bloco de Saúde Financeira; a aba própria permanece disponível.
- O gráfico “Despesas por categoria” e demais exibições passam a usar o nome atual da categoria, priorizando o ID cadastrado.
- Compatibilidade legada: “Liberdade Financeira” é apresentada como “Investimentos” quando essa é a categoria atual.
- Tooltip e textos de categoria acompanham o nome atual.
- Valores, percentuais e cálculos permanecem inalterados.
