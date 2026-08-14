MENTORIA BLACK — V16

Base: V15 consolidada.

CORREÇÕES DESTA VERSÃO
- “Despesa fixa” / “Receita fixa” substituído por “Lançamento recorrente”.
- Recorrências passam a materializar automaticamente os próximos 12 meses.
- Lançamentos recorrentes futuros entram no balanço como pendentes e já aparecem nos meses seguintes.
- Recorrências existentes na V15 são aproveitadas; o sistema evita duplicar lançamentos já existentes.
- A recorrência usa data, descrição, categoria, valor, conta/cartão e tipo para impedir duplicação.
- A auditoria de parcelamentos identifica a parcela pelo número e compra, reduzindo falsos positivos.
- O formulário de “+ Lançamento” mantém o valor em destaque e recebe foco/seleção automaticamente.
- Parcelamentos continuam materializados nos meses seguintes com ajuste exato de centavos.
- Service Worker atualizado para V16 e caches anteriores são removidos.

PUBLICAÇÃO
1. Faça backup da V15.
2. Substitua index.html pelo index-v16.html.
3. Substitua sw.js pelo sw-v16.js.
4. Mantenha manifest.webmanifest.
5. Faça Commit changes.
6. Abra o aplicativo, faça logout/login ou recarregue completamente.

TESTE RECOMENDADO
1. + Lançamento > Receita > Salário > marque “Lançamento recorrente”.
2. Salve e abra o mês seguinte: o salário deve aparecer automaticamente.
3. Avance mais meses: os lançamentos futuros devem continuar aparecendo.
4. Faça uma despesa recorrente e confirme o mesmo comportamento.
5. Faça uma compra parcelada e confirme as parcelas nos meses seguintes.
6. Confirme que uma segunda atualização não cria duplicatas.
7. Confirme que a auditoria só sinaliza parcelas realmente repetidas.
