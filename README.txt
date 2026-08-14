MENTORIA BLACK — V36

BASE: V35

CORREÇÃO PRINCIPAL
- Corrigido o gráfico "Evolução das receitas".
- Os rótulos de valor e percentual agora usam posicionamento inteligente:
  testam posições alternativas ao redor de cada ponto e evitam sobreposição
  com rótulos vizinhos.
- Os rótulos permanecem dentro da área útil do gráfico.
- O gráfico mantém os mesmos valores, cálculos, meses e linha de evolução.
- Nenhum dado ou cálculo de receita foi alterado.

MANTIDO DA V35
- Liberdade Financeira contabilizada também em Investimentos no Dashboard.
- Reserva de emergência no KPI.
- Status antes de Mais opções.
- Parcelamentos pela competência da primeira fatura.
- Recorrentes identificados.
- Busca corrigida.
- Demais regras e cálculos.

ARQUITETURA
- V36 parte diretamente da V35.
- Não foi criado novo bloco para reimplementar versões antigas.
- A alteração ficou isolada no desenho dos rótulos do gráfico de evolução das receitas.
