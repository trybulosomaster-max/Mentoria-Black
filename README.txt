MENTORIA BLACK — V22

CORREÇÃO DA ABA LANÇAMENTOS
- Busca funcionando em descrição, categoria, subcategoria, observação e forma de pagamento.
- Tipo: Todos, Receita, Despesa, Investimento, Transferência e Resgate.
- Categoria: todas as categorias disponíveis e também categorias presentes em lançamentos históricos.
- Mês: Todos os meses + Janeiro a Dezembro.
- Ano: Todos os anos + somente anos existentes nos lançamentos.
- Filtros combináveis: mês, ano, mês + ano, tipo, categoria e busca.
- Lista completa de lançamentos preservada.
- Edição, exclusão, parcelamentos, recorrências, data da compra e data da fatura preservados.
- Cabeçalho mostra o período e a quantidade encontrada.
- Limpar filtros aparece somente quando necessário.
- Layout otimizado para celular e tabela com rolagem horizontal segura.
- Dashboard, Planejamento, Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio e Relatórios não são alterados pelos filtros de Lançamentos.
- Corrigido o risco de interface mostrar Dashboard enquanto Lançamentos está selecionado.
- Service Worker V22 com cache novo e atualização forçada.

PUBLICAÇÃO
1. Substitua index.html pelo index-v22.html.
2. Substitua sw.js pelo sw-v22.js.
3. Mantenha manifest.webmanifest.
4. Faça commit dos dois arquivos.
5. Abra o sistema novamente. A V22 registra sw.js?v=22 e remove caches antigos automaticamente.
