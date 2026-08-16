MENTORIA BLACK — V65 FINAL

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


CORREÇÃO V65 — BASE V63 + PATCH FINAL
- V63 FINAL permanece como base funcional.
- A correção é inserida dentro do HTML carregado pela aplicação, após a camada V63, evitando o erro de tela “Carregando”.
- Saúde Financeira: removido da Dashboard somente o card de acesso rápido; a aba própria continua disponível.
- Categorias: o nome atual é resolvido pelo ID da categoria quando disponível.
- Compatibilidade legada: “Liberdade Financeira” é exibida como “Investimentos” quando essa é a categoria atual.
- Dashboard: gráfico, tooltip e textos visíveis acompanham o nome “Investimentos”.
- O wrapper de renderização reaplica a correção após o carregamento dos componentes e gráficos.
- Não altera valores, percentuais, datas, tipos ou cálculos das transações.
- Mantidos os 3 arquivos: index.html, sw.js e README.txt.
