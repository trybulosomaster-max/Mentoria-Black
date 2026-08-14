Mentoria Black — V32

Pacote consolidado com 3 arquivos:
- index.html
- sw.js
- README.txt

V32 — CONSOLIDAÇÃO E CORREÇÕES
- As camadas V29, V30 e V31 foram consolidadas em uma única camada V32.
- Não existem blocos separados de override V29/V30/V31 no final do index.html.
- Receita possui parcelamento e recorrência, inclusive combinados.
- Status fica fora de “Mais opções” e aparece antes dela.
- Reserva de emergência ocupa o KPI no lugar de Gastos Fixos; o card inferior redundante é removido sem perder o cálculo.
- Investimentos continuam sendo saída financeira para saldo/orçamento e aparecem separadamente como investimento.
- Últimos lançamentos identificam recorrências.
- Parcelamentos de cartão usam a PRIMEIRA FATURA como competência da parcela 1; a data da compra permanece apenas como histórico.
- O campo “Primeira fatura” continua editável; a aplicação não sobrescreve uma escolha explícita com a data da compra.
- Parcelas seguintes avançam mês a mês a partir da primeira fatura.
- Prévia das parcelas e ajuste de centavos preservados.
- Exclusão inteligente de parcelas/recorrências preservada.
- Categorias, filtros, planejamento, cartões, contas, metas, patrimônio e relatórios preservados.
- Service Worker atualizado para V32 e caches anteriores removidos na ativação.

PUBLICAÇÃO
1. Substitua index.html.
2. Substitua sw.js.
3. Mantenha manifest.webmanifest.
4. Faça commit.
5. Recarregue completamente o aplicativo.

TESTE CRÍTICO DO CARTÃO
Compra: 14/08/2026
Primeira fatura: 01/09/2026
Valor: R$ 200,00 em 2x
Resultado esperado: R$ 100,00 em setembro + R$ 100,00 em outubro; nenhuma parcela em agosto.

TESTE DO FORMULÁRIO
1. Novo lançamento.
2. Confirme Status antes de “Mais opções”.
3. Receita: confirme Parcelar lançamento e Lançamento recorrente.
4. Despesa no cartão: informe compra e primeira fatura diferentes.
5. Confirme a prévia e as competências das parcelas.
6. Confirme que recorrentes aparecem identificados nos Últimos lançamentos.
7. Confirme Investimentos no Dashboard e no cálculo do saldo.
8. Confirme Reserva de emergência no KPI e ausência do card inferior duplicado.
