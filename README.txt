MENTORIA BLACK — V21.2

Melhoria da aba LANÇAMENTOS, preservando as funções da V19/V21.1.

PRESERVADO:
- lista única com todos os lançamentos;
- opção de visualizar todos os lançamentos;
- Busca;
- filtro por Tipo;
- filtro por Categoria;
- edição/exclusão;
- tabela completa;
- separação entre data da compra e data da fatura do cartão;
- demais módulos e funções existentes.

MELHORADO NA V21.2:
- filtro de período reorganizado para ficar mais limpo no celular;
- Mês separado em Janeiro a Dezembro;
- Ano separado, com os anos existentes nos dados;
- possibilidade de filtrar somente por mês, somente por ano ou por mês + ano;
- "Todos os meses" continua disponível;
- resumo do período mostra apenas a quantidade de lançamentos encontrados;
- botão "Limpar filtros" quando houver filtros ativos;
- removido o bloco redundante que deixava a tela visualmente carregada;
- layout responsivo para telas menores.

IMPORTANTE:
O filtro de período atua somente na aba Lançamentos.
Dashboard, Planejamento, Contas e demais módulos continuam independentes.

DEPLOY:
1. Substitua os arquivos publicados pelos arquivos desta pasta.
2. Mantenha index.html na raiz publicada pelo GitHub Pages.
3. Publique index.html e sw.js juntos.
4. O Service Worker usa uma chave nova (V21.2) para evitar carregar o cache da V21.1.
5. Se o navegador ainda mostrar a versão anterior, feche a aba e abra novamente; se necessário, limpe os dados do site.
