Mentoria Black — V29

Pacote final com 3 arquivos:
- index.html
- sw.js
- README.txt

V29 — RECEITAS COM PARCELAMENTO E RECORRÊNCIA
- Receita agora possui “Parcelar lançamento”.
- Receita agora possui “Lançamento recorrente”.
- As duas opções são independentes e podem ser usadas juntas, como já ocorre nas despesas.
- Parcelamento de receita cria todas as parcelas futuras com ajuste exato de centavos na última parcela.
- Recorrência de receita cria uma regra mensal e materializa os próximos lançamentos usando a mesma lógica já consolidada.
- Cartão continua bloqueado para receitas; conta continua obrigatória.
- Ao trocar para Receita, as opções de parcelamento/recorrência permanecem disponíveis e o cartão é limpo/ocultado.
- A edição de lançamentos existentes continua sem recriar parcelas ou regras automaticamente.
- A exclusão inteligente de parcelas/recorrências da V27 permanece preservada.
- Dashboard, Planejamento, Lançamentos, Contas, Cartões, Categorias, Metas, Patrimônio e Relatórios não recebem alterações de lógica fora desse escopo.
- Service Worker atualizado para V29 e caches anteriores são removidos na ativação.

PUBLICAÇÃO
1. Substitua index.html pelo arquivo desta V29.
2. Substitua sw.js pelo arquivo desta V29.
3. Mantenha manifest.webmanifest.
4. Faça commit dos dois arquivos.
5. Abra o sistema novamente e faça uma atualização completa se necessário.

TESTE RECOMENDADO
1. + Novo lançamento > Receita > informe Salário e uma conta.
2. Confirme que aparecem “Parcelar lançamento” e “Lançamento recorrente”.
3. Teste somente recorrente: deve criar o lançamento atual + próximos meses, sem duplicar após atualizar.
4. Teste somente parcelado: 3 parcelas devem aparecer nos meses seguintes e a soma deve ser exatamente igual ao valor total.
5. Teste parcelado + recorrente: as duas séries devem ser criadas sem erro.
6. Confirme que Receita não permite cartão de crédito.
7. Edite uma parcela existente e confirme que não nasce uma nova série.
8. Teste a exclusão inteligente e confirme as opções “somente este”, “este e futuros” e “todos” conforme a série.
