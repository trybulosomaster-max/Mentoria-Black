MENTORIA BLACK — V15

Correções e melhorias:
- Marca centralizada no cabeçalho: símbolo MB acima, MENTORIA BLACK e GESTÃO FINANCEIRA abaixo.
- Símbolo redesenhado em SVG vetorial, simétrico e responsivo.
- Parser monetário robusto: aceita 1000, 1000,50, 1.000,50, 1000.50 e 1,000.50.
- Campo de lançamento formata o valor ao sair do campo.
- Auditoria de parcelas: duplicações claramente marcadas como Parcelado X/Y são ignoradas nos cálculos, sem apagar registros.
- Aviso de auditoria no Dashboard quando houver duplicidade.
- Service Worker V15 remove caches antigos e força atualização.
- Atualização do Service Worker com updateViaCache:none.
- Mantidos planejamento por ano/mês, cores de categorias, gráficos, cartões, reserva de emergência e validações da V13.
- Anos de 2000 a 2100.
- Parcelamento pelo valor total, quantidade e mês inicial.
- Despesa fixa separada do parcelamento.

Publicação:
Substitua no GitHub:
index.html
sw.js
README.txt

Mantenha manifest.webmanifest.


V15 — VISUAL
- Dashboard inspirado nas referências: KPIs com indicadores visuais, metas com progresso, últimos lançamentos compactos e cartões em blocos harmonizados.
- Planejamento com cards visuais por categoria, mantendo as categorias separadas para não alterar a lógica financeira existente.
- Ícones das categorias podem ser alterados na aba Categorias; a personalização é armazenada localmente no dispositivo para não exigir alteração no banco Supabase.
- Mantida a identidade preta/dourada e o gráfico de barras com valor + percentual acima das barras.
- Service Worker atualizado para V15 e limpeza automática de caches antigos.
- Não exige alteração do manifest.webmanifest.
