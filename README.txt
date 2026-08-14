MENTORIA BLACK — V17

Correções desta versão:
1. Recorrências são materializadas antes do primeiro Dashboard renderizar, inclusive após login/restauração de sessão.
2. Recorrências existentes com próxima data antiga (ex.: 01/08/2026) são processadas mês a mês até 12 meses à frente, sem duplicar lançamentos.
3. Os lançamentos futuros recorrentes ficam como Pendente e passam a aparecer no Dashboard do mês correspondente.
4. O Dashboard agora mostra “Últimos lançamentos do período”, e não os últimos registros globais de outro mês.
5. + Lançamento abre com o campo Valor focado e selecionado; no iPhone o teclado numérico pode abrir automaticamente ao receber foco.
6. O gráfico “Distribuição planejada” usa rótulos inteligentes, evitando que valores e porcentagens se sobreponham.
7. “monthly” é exibido como “Mensal” na tela de Recorrências.
8. Parcelamentos continuam sendo transações reais nos meses seguintes.
9. Service Worker atualizado para V17 para evitar cache antigo.

PUBLICAÇÃO
- Faça backup da V16.
- Substitua index.html por index-v17.html.
- Substitua sw.js por sw-v17.js.
- Mantenha manifest.webmanifest.
- Faça Commit changes.
- Abra o app e faça logout/login ou atualização completa.

TESTE
- Abra Dashboard > Setembro/Outubro de 2026 e confirme Salário/Aluguel e demais recorrências.
- Abra Lançamentos no mês seguinte e confirme as parcelas.
- Clique + Lançamento e confira se o teclado numérico abre no valor.
- Vá em Planejamento e confirme que os rótulos não ficam sobrepostos.
