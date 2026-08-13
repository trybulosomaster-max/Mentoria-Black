MENTORIA BLACK — V8
=====================

Arquivos desta versão:
- index.html
- sw.js
- README.txt

OBJETIVO DA V8
---------------
Versão de auditoria e estabilização do dashboard financeiro, preservando a estrutura de dados já usada pela V7.

CORREÇÕES PRINCIPAIS
--------------------
1. Gráfico "Despesas por categoria":
   - mantém barras verticais;
   - usa a cor cadastrada para cada categoria;
   - mostra diretamente acima de cada barra o valor em R$;
   - mostra também o percentual daquela categoria sobre o total do período;
   - recalcula automaticamente quando ano/mês mudam;
   - evita depender da legenda para descobrir valor/percentual.

2. Distribuição planejada:
   - usa a mesma função de cor das categorias;
   - mantém a correspondência entre Gastos Fixos, Investimentos, Conforto, Metas, Lazer e Conhecimento;
   - não usa uma cor dourada única para todas as barras.

3. Planejamento:
   - ano de 2000 a 2100;
   - cada combinação ano + mês possui seu próprio planejamento;
   - estratégia percentual é recalculada a partir da receita planejada.

4. Parcelamento:
   - informa-se o valor TOTAL da compra;
   - seleciona-se "Parcelar";
   - o número de parcelas aparece somente depois da seleção;
   - o sistema mostra a prévia "1x/R$..., 2x/R$..., 3x/R$...";
   - pode-se escolher o mês inicial do pagamento;
   - parcelas são criadas nos meses seguintes;
   - a última parcela recebe o ajuste de centavos para fechar exatamente o total;
   - mês inicial não pode ser anterior ao mês da compra.

5. Despesa fixa:
   - substitui a lógica de "repetir mensalmente";
   - basta marcar "Despesa fixa";
   - cria uma recorrência mensal;
   - não mistura despesa fixa com parcelamento.

6. Cartões:
   - resumo por cartão no período selecionado;
   - total consolidado.

7. Reserva de emergência:
   - Dashboard procura metas, contas ou ativos com "Reserva", "Emergência" ou "Caixinha";
   - mostra o valor acumulado;
   - quando houver meta com objetivo, mostra progresso.

8. Planejado x realizado:
   - mantém o resumo geral;
   - mostra também comparação por categoria;
   - mostra planejado, realizado e execução.

9. Categorias:
   - edição disponível;
   - exclusão protegida contra registros vinculados;
   - cor cadastrada é usada nos gráficos;
   - impede duplicação de nomes de categorias.

AUDITORIA / PONTOS DE ATENÇÃO
-----------------------------
A V8 não altera o banco de dados e usa as mesmas tabelas/colunas da V7. Isso reduz o risco de quebrar os dados existentes.

Validações importantes:
- não permite vincular simultaneamente conta e cartão ao mesmo lançamento;
- não permite parcelamento/recorrência para tipos incompatíveis;
- não permite parcela com mês inicial anterior à compra;
- não permite valores negativos nas principais telas;
- impede excluir conta/cartão/categoria que ainda possua registros vinculados;
- limita parcelamento a 120 parcelas;
- usa datas reais para meses com 28, 29, 30 e 31 dias;
- recorrências possuem proteção contra duplicação pelo conjunto data + descrição + valor.

TESTE RECOMENDADO
-----------------
Depois de publicar:
1. Atualize o site.
2. Se o navegador continuar mostrando a V7, faça uma atualização forçada/limpe o cache do site.
3. Teste uma categoria com cor diferente do dourado.
4. Faça um lançamento de R$ 1.000,00.
5. Confira o gráfico: deve aparecer R$ 1.000,00 e 100,0% acima da barra.
6. Faça uma segunda categoria e confira se os percentuais somam aproximadamente 100%.
7. Teste uma compra de R$ 1.000,00 em 3x iniciando no mês seguinte.
8. Confirme 333,33 + 333,33 + 333,34 = R$ 1.000,00.
9. Teste uma despesa fixa e confirme que ela aparece como recorrência.
10. Teste planejamento em 2027 e depois volte para 2026.
11. Confira reserva de emergência no Dashboard.
12. Confira planejado x realizado por categoria.

OBSERVAÇÃO
----------
A V8 é uma correção de aplicação. Regras contábeis, fechamento de fatura, limite disponível de cartão e conciliação bancária ainda dependem de regras específicas do banco/esquema de dados e não devem ser inferidas apenas pelo valor de um lançamento.
