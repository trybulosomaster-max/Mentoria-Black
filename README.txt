MENTORIA BLACK — V64 FINAL

STATUS
V60 consolidada a partir da V59 estável, seguindo o Prompt Escudo.

PRINCÍPIO DE CONSOLIDAÇÃO
- Não foi criada uma nova camada V60 sobre a V59.
- As extensões de Reserva e Saúde Financeira foram incorporadas a um único módulo de integração V60.
- Não existem sobrescritas em cascata de render/nav/dashboard entre as extensões V50–V59.
- Existe um único ponto final de integração para navegação, renderização e Dashboard.
- Nenhum schema do Supabase foi alterado.
- Nenhum lançamento existente foi apagado ou recriado.

FUNCIONALIDADES PRESERVADAS
- Autenticação Supabase por usuário.
- Dashboard.
- Lançamentos.
- Planejamento.
- Contas.
- Cartões.
- Categorias.
- Metas.
- Recorrências.
- Patrimônio.
- Relatórios.
- Reserva de Emergência.
- Saúde Financeira.
- Parcelamentos e exclusão inteligente.
- Regras de receitas, despesas e investimentos da base consolidada.

RESERVA DE EMERGÊNCIA
- Mantém a carteira/ledger própria da Reserva criada anteriormente.
- A meta por Gastos Fixos usa a média dos 6 meses completos anteriores ao período selecionado.
- O mês selecionado não entra na média.
- Valor personalizado permanece independente.
- Outubro/2026 deve considerar Abril–Setembro/2026 na média.

DASHBOARD
- Não exibe card de Saúde Financeira.
- Não exibe card de Inteligência Black.
- Não exibe bloco detalhado duplicado da Reserva.
- Mantém o KPI da Reserva de Emergência.
- Mantém os demais indicadores e acompanhamento de investimentos da base.
- A análise completa permanece na aba própria de Saúde Financeira.

NAVEGAÇÃO
- Reserva de Emergência possui aba própria.
- Saúde Financeira possui aba própria.
- Não há criação repetida dessas abas em cada renderização.

PERÍODO E DADOS
- O filtro de período continua baseado em Ano + Mês.
- Os dados de Outubro/2026 não são alterados pelo código desta versão.
- Nenhuma correção de interface deve apagar ou recriar transações.

CACHE
- Service Worker: mentoria-black-v60.
- O cache anterior é removido na ativação.
- O fetch usa cache:no-store para evitar servir uma versão antiga.

TESTES OBRIGATÓRIOS ANTES DA PUBLICAÇÃO
1. Login e logout.
2. Dashboard.
3. Janeiro–Dezembro de 2026.
4. Outubro/2026 especificamente.
5. Receitas.
6. Despesas.
7. Investimentos.
8. Lançamentos parcelados.
9. Recorrências.
10. Cartões.
11. Categorias.
12. Metas.
13. Reserva de Emergência.
14. Saúde Financeira.
15. Relatórios/PDF.
16. Atualizar dados.
17. Verificar que nenhum dado do Supabase foi alterado.
18. Verificar que a tela não fica presa em “Carregando”.

REGRA PARA AS PRÓXIMAS VERSÕES
Toda nova versão deve partir desta V60 limpa/consolidada, ser auditada antes da alteração e incorporar a mudança diretamente à implementação definitiva.
Não adicionar patches de versão sobrepostos.

ARQUIVOS OFICIAIS
- index.html
- sw.js
- README.txt
Mantenha o manifest.webmanifest existente no projeto.


V64 — PROMPT ESCUDO / CATEGORIAS DINÂMICAS
- Base: V60 FINAL.
- A lógica definitiva do gráfico “Despesas por categoria” usa o nome atual da categoria.
- Investimentos é normalizado pelo tipo da transação e pelo cadastro atual.
- A cor do gráfico é sempre obtida da mesma categoria cadastrada em DATA.categories.
- Tooltip, barras e relatórios usam a mesma função de cor.
- O rótulo histórico “Liberdade Financeira” não é utilizado pela apresentação.
- Nenhum schema ou dado do Supabase foi alterado.
- Nenhum patch externo foi adicionado.
- Nenhum carregamento de outra versão foi criado.
- Mantidos os arquivos oficiais: index.html, sw.js e README.txt.


V64 — PROMPT ESCUDO
- Correção definitiva do gráfico Despesas por categoria.
- Dados históricos cujo rótulo contenha os termos de liberdade + financeira são normalizados para a categoria atual Investimentos.
- O Dashboard nunca recebe o rótulo histórico.
- A cor é obtida diretamente da categoria atual cadastrada.
- Planejamento e Despesas por categoria usam a mesma fonte de cores.
- Nenhum dado/schema do Supabase foi alterado.


V64 — PROMPT ESCUDO / CORREÇÃO RAIZ DO GRÁFICO
- Causa: uma implementação posterior sobrescrevia expensesByCat e um wrapper histórico envolvia topCategory.
- Esses overrides foram removidos da execução.
- A resolução de categoria normaliza o rótulo histórico antes da busca exata.
- Lançamentos antigos agora usam o nome atual cadastrado: Investimentos.
- O gráfico usa a mesma função canônica e a mesma fonte de cor da aba Categorias.
- Nenhum dado/schema do Supabase foi alterado.

V64 — PROMPT ESCUDO EVOLUÍDO
- Correção de raiz para categorias históricas: normalização ocorre antes da busca exata.
- “Liberdade Financeira” não pode chegar à camada de apresentação; é resolvida para Investimentos.
- Despesas por categoria usa a função canônica de categoria.
- Cores vêm do cadastro atual da categoria.
- Overrides históricos específicos de topCategory/expensesByCat foram removidos.
- Orquestração funcional de renderização não é tratada como patch por si só.
- Nenhum dado/schema do Supabase foi alterado.
