MENTORIA BLACK — GESTÃO FINANCEIRA V9

Arquivos: index.html, sw.js

V9 — correções e auditoria
- Logo MB + MENTORIA BLACK + GESTÃO FINANCEIRA integrada ao cabeçalho e tela de login.
- Planejamento: Lazer e Conhecimento agora aparecem separadamente; nenhum KPI soma os dois.
- Distribuição planejada usa a mesma cor cadastrada na categoria.
- Gráficos de despesas usam colunas, cores por categoria e mostram valor + percentual acima das barras.
- Relatório por categoria também usa colunas para manter consistência visual.
- Ao renomear categoria, referências existentes em lançamentos, recorrências e subcategorias são sincronizadas.
- Anos disponíveis: 2000 a 2100.
- Parcelamento: valor total, quantidade de parcelas e mês inicial; última parcela ajusta centavos para fechar o total.
- Despesa fixa é separada de parcelamento e gera recorrência mensal.
- Reserva de emergência identificada por nomes contendo Reserva, Emergência ou Caixinha em metas, contas ou ativos.
- Cartões mostram resumo do período e total.

Auditoria adicional
- Validação de conta x cartão exclusivo.
- Validação de categoria e valor positivo.
- Proteção contra exclusão de categorias/contas/cartões com dependências.
- Cache atualizado para V9 no service worker.
- Mantida compatibilidade com as tabelas já utilizadas pela V8; não há migração destrutiva de banco nesta versão.

Importante
Substitua index.html e sw.js no GitHub Pages. O README é documentação e pode ser mantido separadamente.
