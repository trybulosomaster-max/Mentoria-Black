MENTORIA BLACK — V80 ESCUDO FINAL

BASE
- Base funcional consolidada carregada sem alterar o schema do Supabase.
- Nenhuma transação é apagada, recriada ou migrada pela correção.

ERRO-RAIZ ENCONTRADO — EVOLUÇÃO DAS RECEITAS
- O núcleo anterior (V70/V79) lia `window.DATA.transactions`.
- A base declara `let DATA = ...` e `let FILTERS = ...`. Declarações `let` no escopo global de um script NÃO viram propriedades de `window`.
- Resultado: `window.DATA` era `undefined`, a rotina assumia `[]` e o gráfico/total da Evolução das receitas recebia doze zeros, enquanto os KPIs do Dashboard, que acessavam `DATA` diretamente, mostravam R$ 8.523,68.
- O mesmo problema afetava `window.FILTERS`, podendo fazer a evolução usar o ano padrão em vez do filtro atual.

CORREÇÃO V80
- A própria base expõe pontes controladas a partir do escopo lexical real: `window.__MB_GET_DATA__()` e `window.__MB_GET_FILTERS__()`.
- O núcleo de receita usa essas pontes, nunca `window.DATA`/`window.FILTERS`.
- A regra aceita `transaction_type/type = receita`, datas ISO ou BR e `amount/value`.
- Canceladas ficam fora. Pendentes/futuras permanecem disponíveis para previsibilidade; realizado e projetado não são misturados silenciosamente no mesmo indicador.
- O total exibido no card e os valores mensais do gráfico vêm da mesma função canônica.
- Não há alteração de schema ou de dados do Supabase.

TESTES EXECUTADOS
1. Receita de salário em outubro/2026: PASS.
2. Receita pendente em outubro/2026: PASS.
3. Renda extra: PASS.
4. Outra receita: PASS.
5. Data DD/MM/YYYY: PASS.
6. Campo `value` como fallback: PASS.
7. Receita cancelada: corretamente excluída.
8. Receita de ano diferente: corretamente excluída.
9. Reprodução controlada do defeito: `window.DATA` -> R$ 0,00; ponte para DATA real -> valor correto.
10. Sintaxe JavaScript completa da V80: PASS.

ESCUDO
- Uma única fonte canônica para Evolução das receitas.
- Proibido acessar estado financeiro lexical por `window.DATA`/`window.FILTERS`.
- Antes de cada versão: procurar funções duplicadas, wrappers, IDs duplicados, pipelines paralelos, aliases antigos e divergência entre KPIs, gráficos e tabelas.
- Não corrigir erro de dados com alteração visual.
- Não alterar regra financeira para mascarar erro de renderização.
- Não apagar/recriar lançamentos.
- Não alterar schema/migração do Supabase sem solicitação explícita.

ARQUIVOS OFICIAIS
- index.html
- sw.js
- README.txt
