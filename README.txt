MENTORIA BLACK — V37

BASE: V36

CONSOLIDAÇÃO TÉCNICA
- Removidos os quatro blocos históricos de patch V29/V30/V31/V36 do HTML.
- As correções recentes agora ficam em UM único módulo consolidado V37.
- Não deve ser criado outro override para essas mesmas regras nas próximas versões;
  alterações futuras devem ser feitas neste módulo ou na implementação-base.

CORREÇÕES
- Investimentos reconhecem:
  1) transaction_type = investimento; e
  2) categoria principal = Liberdade Financeira.
- Essa regra foi aplicada ao KPI, ao planejado x realizado e ao card de investimentos.
- Liberdade Financeira continua entrando como saída/despesa para saldo e orçamento.
- Reserva de emergência permanece no KPI.
- Status permanece antes de Mais opções.
- Parcelamento de cartão usa a primeira fatura como competência inicial.
- Recorrentes e progresso das parcelas permanecem identificados.
- Busca mantém foco e posição do cursor durante a filtragem.
- Gráfico de evolução das receitas mantém a correção de rótulos sem sobreposição.

MANUTENÇÃO
- V37 não adiciona uma nova camada de V29/V30/V31/V36.
- O Service Worker usa cache mentoria-black-v37.
