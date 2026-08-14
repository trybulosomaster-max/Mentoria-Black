MENTORIA BLACK — V15

Arquivos desta versão:
- index.html — versão consolidada V15
- sw.js — Service Worker V15

Mantenha manifest.webmanifest e os demais arquivos do projeto.

PRINCIPAIS CORREÇÕES
- Receitas possuem categorias próprias e não aparecem nas categorias de despesas.
- O formulário abre com o valor em destaque e os campos essenciais primeiro.
- “Mais detalhes” contém parcelamento, recorrência, cartão, observação e outros campos opcionais.
- Receita, despesa e investimento têm seleção de categoria compatível.
- Receita sem categoria não pode ser salva.
- Dashboard ganhou gráfico exclusivo “Evolução das receitas”, mês a mês no ano selecionado.
- O gráfico de receitas não mistura despesas, investimentos ou transferências.
- Parcelamentos continuam sendo calculados em centavos para evitar diferença de arredondamento.
- O Service Worker muda de cache V14 para V15 para evitar carregar a versão antiga.
- Categorias de receita existentes no Supabase são preservadas; se não houver nenhuma, o aplicativo cria as categorias padrão.

PUBLICAÇÃO
1. Faça backup do index.html e sw.js atuais.
2. No GitHub, substitua index.html pelo arquivo desta versão.
3. Substitua sw.js pelo arquivo desta versão.
4. NÃO substitua manifest.webmanifest.
5. Faça Commit changes.
6. Abra o aplicativo e faça logout/login ou recarregue completamente.
7. Teste primeiro: + Lançamento > Receita > Salário.
8. Depois teste uma Despesa e confirme que as categorias são diferentes.

BANCO
As regras estruturais de categoria de receita/despesa já foram aplicadas no Supabase. Não execute migrations novamente apenas para publicar estes arquivos.
