MENTORIA BLACK — V14

Correções e melhorias:
- Marca centralizada no cabeçalho: símbolo MB acima, MENTORIA BLACK e GESTÃO FINANCEIRA abaixo.
- Símbolo redesenhado em SVG vetorial, simétrico e responsivo.
- Parser monetário robusto: aceita 1000, 1000,50, 1.000,50, 1000.50 e 1,000.50.
- Campo de lançamento formata o valor ao sair do campo.
- Auditoria de parcelas: duplicações claramente marcadas como Parcelado X/Y são ignoradas nos cálculos, sem apagar registros.
- Aviso de auditoria no Dashboard quando houver duplicidade.
- Service Worker V14 remove caches antigos e força atualização.
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
