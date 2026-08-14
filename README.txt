MENTORIA BLACK — V18

V18 foi construída sobre a V17 enviada pelo usuário, preservando a lógica e as funcionalidades existentes e corrigindo pontos de desempenho, fluxo e integridade.

PRINCIPAIS MELHORIAS
1. Carregamento inicial: as consultas independentes ao Supabase agora são feitas em paralelo, reduzindo o tempo de espera.
2. Recorrências: geração futura usa inserção em lotes, em vez de uma chamada ao Supabase por lançamento.
3. Recorrências: o fluxo antigo load → materializa → load foi eliminado. A V18 atualiza os dados em memória após a materialização.
4. Recorrências: cada lançamento automático mantém o ID da regra como referência, evitando que duas recorrências diferentes com mesmo valor/descrição sejam confundidas.
5. Dashboard/Lançamentos: lançamentos pendentes exibem botão “Pagar” para marcar como realizado.
6. Parcelamentos: excluir uma parcela agora permite escolher entre excluir somente a parcela ou toda a compra parcelada.
7. Recorrências: ao excluir uma regra, há opção de remover também os lançamentos futuros ainda pendentes daquela regra, preservando os já realizados.
8. Busca: filtro de lançamentos usa debounce de 180 ms, evitando reconstruir a tela a cada tecla.
9. Inicialização: tela de carregamento evita aparência de travamento durante a leitura dos dados.
10. Service Worker: cache atualizado para V18 e requisições não-GET não são interceptadas.
11. Mantidos: categorias de receitas/despesas, parcelamentos, planejamento, gráficos, contas, cartões, metas, patrimônio e relatórios da V17.

VALIDAÇÃO
- JavaScript validado com Node.js --check.
- Verificações estáticas realizadas para carregamento paralelo, materialização em lote, pagamento de pendentes, debounce, versão do Service Worker e referências V18.
- Não é possível simular no ambiente local as políticas RLS e o banco Supabase real do usuário; por isso, a V18 não altera schema nem credenciais.

ARQUIVOS
- index.html
- sw.js
- README.txt

PUBLICAÇÃO
1. Faça backup da V17.
2. Substitua index.html pelo index.html da V18.
3. Substitua sw.js pelo sw.js da V18.
4. Mantenha o manifest.webmanifest existente.
5. Faça commit.
6. Abra o app, faça logout/login e teste Dashboard, Lançamentos, Planejamento e Recorrências.

ATENÇÃO
O arquivo index.html contém a URL e a chave pública (anon/publishable) do Supabase, como já ocorria na V17. A proteção dos dados depende das políticas RLS do Supabase; a V18 não expõe nenhuma chave secreta adicional.
