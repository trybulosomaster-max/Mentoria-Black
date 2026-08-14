MENTORIA BLACK — V18 CORRIGIDA

Base: V17 completa enviada pelo usuário.

Correções desta V18.1:
1. Corrigido o bootstrap da aplicação: se não houver sessão, a tela de carregamento é encerrada e o login aparece.
2. Se o Supabase demorar demais ou estiver indisponível, a tela de carregamento não fica presa indefinidamente.
3. Erros durante a inicialização agora devolvem o usuário à tela de login com mensagem clara.
4. Corrigido o processamento das recorrências em lote para não alterar o array de lançamentos enquanto ele está sendo percorrido.
5. Mantidas as melhorias da V18: carregamento otimizado, recorrências materializadas em lote, categorias separadas por tipo, evolução anual das receitas, planejamento, parcelas e demais recursos da V17.

PUBLICAÇÃO
- Substitua index.html pelo index.html deste pacote.
- Substitua sw.js pelo sw.js deste pacote.
- Mantenha o manifest.webmanifest que já está no projeto.
- Faça commit/push.
- No iPhone, depois da publicação, abra o site e recarregue. Se o Safari ainda mostrar a versão antiga, use uma aba privada ou remova os dados do site e abra novamente.

IMPORTANTE
- Não é necessário alterar o banco Supabase para esta correção.
- As credenciais e o schema existentes foram preservados.
