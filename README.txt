MENTORIA BLACK — V62
======================
Base: arquivos V61 enviados pelo usuário, com correções incrementais.

Correções desta V62:
1. Dashboard: seletor real de mês e ano, sem travamento em novembro/2026.
2. Dashboard: botões Atualizar e Sair restaurados; impressão permanece centralizada em Relatórios.
3. Dashboard: resumo compacto da Reserva de Emergência restaurado.
4. Dashboard: resumo compacto de Patrimônio Líquido restaurado.
5. Despesas por categoria: inclui Despesas + Investimentos, com valor e percentual.
6. Cores do gráfico vêm da aba Categorias.
7. Aba Categorias restaurada, com cadastro de nome/cor/tipo.
8. Resumo dos lançamentos movido para a aba Lançamentos.
9. Revisão adicional: filtros de período deixam de ficar permanentemente presos em 2026-11.
10. Os dados locais da V61 são preservados somente se a chave anterior estiver migrada manualmente; esta V62 usa a chave mentoria_black_v62 para evitar sobrescrever a V61 durante os testes.

ATENÇÃO:
O arquivo V61 enviado nesta conversa é uma versão local baseada em localStorage e não contém código Supabase. Portanto, esta V62 preserva a arquitetura real desse arquivo, sem inventar uma integração de backend que não está presente no material enviado.

Arquivos do pacote:
- index.html
- sw.js
- README.txt
Sem manifest.json, mantendo o padrão de 3 arquivos.
