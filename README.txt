MENTORIA BLACK — V63 FINAL

BASE
- V60 FINAL funcional preservada como base.
- Mantém Supabase, autenticação, Cartões, Categorias, Metas, Recorrências, Patrimônio, Reserva, Saúde Financeira, Receitas, Investimentos, Parcelados e Relatórios.
- Sem alteração de schema/migração do Supabase.

CORREÇÕES V63
1. Dashboard mantém seleção de mês e ano da base V60.
2. Dashboard mantém Atualizar e Sair funcionais da autenticação Supabase.
3. PDF/Imprimir é ocultado somente na Dashboard; a impressão permanece em Relatórios.
4. Resumo da Reserva de Emergência e Patrimônio permanece na Dashboard, com detalhes nas abas próprias.
5. Despesas por categoria passa a incluir também Investimentos como saída financeira.
6. Gráfico de categorias preserva as cores cadastradas na aba Categorias e mostra valor + percentual no tooltip.
7. Aba Categorias e aba Cartões são preservadas da V60.
8. Resumo operacional dos lançamentos foi colocado na aba Lançamentos, sincronizado com o período selecionado.
9. A base V60 continua responsável pelos módulos completos de Metas, Recorrências, Parcelados, Receitas, Investimentos, Reserva, Saúde e Relatórios.

ARQUIVOS
- index.html
- sw.js
- README.txt
Sem manifest.json e sem quarto arquivo.
