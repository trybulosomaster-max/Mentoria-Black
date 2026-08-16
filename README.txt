MENTORIA BLACK — V81 ESCUDO FINAL

Base: V69 consolidada, sem loader externo.

Correção principal:
- Evolução das receitas usa a mesma DATA.transactions carregada pelos KPIs.
- Inclui receitas realizadas e pendentes/futuras para previsibilidade.
- Exclui apenas registros cancelados/canceled/cancelled.
- Aceita transaction_date, date, due_date e created_at como fallback de data.
- Aceita amount, value e valor como fallback de valor.
- Normaliza datas ISO e DD/MM/YYYY.
- Não depende de window.DATA nem de fetch de outro index.html.

Escudo:
- V81 é autocontida no index.html.
- Não sobrepõe V70/V80.
- Não altera dados do Supabase.
- Service Worker atualizado para V81.
- Três arquivos principais: index.html, sw.js e README.txt.
