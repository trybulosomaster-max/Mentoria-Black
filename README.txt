MENTORIA BLACK — V19

Base: V18 corrigida enviada pelo usuário. O V18 já corrigia o bootstrap/splash e as recorrências em lote. A V19 acrescenta a correção estrutural das categorias, o fluxo de cartão com compra separada da competência da fatura e uma revisão de bugs/gargalos encontrados no código.

ALTERAÇÕES V19

1. CATEGORIAS — CORREÇÃO DEFINITIVA
- Despesa, Receita e Investimento usam listas compatíveis com seus tipos.
- Normalização de categorias legadas: despesa/expense, receita/income, ambos/both etc.
- Categorias padrão de despesa são preservadas como despesa.
- Categorias padrão de receita são preservadas como receita.
- A validação do banco foi consolidada em um único trigger determinístico.
- Removidos os dois validadores concorrentes que podiam gerar o erro:
  "A categoria não é compatível com o tipo escolhido."
- Investimento usa categoria de despesa, conforme a regra do sistema.
- Transferências e resgates não aceitam categoria.

2. CARTÃO DE CRÉDITO — COMPRA X FATURA
- A tabela transactions já possuía purchase_date; a V19 passa a utilizá-la.
- Data da compra: registra quando a compra realmente ocorreu.
- Data da despesa na fatura: continua em transaction_date e determina o mês em que o gasto aparece no sistema.
- É possível comprar em um mês e lançar a despesa em outro.
- Ao selecionar um cartão, o sistema sugere a data da primeira fatura usando fechamento/vencimento, mas o usuário pode alterar manualmente.
- A tela de cartões passou a permitir cadastrar o dia de fechamento da fatura.
- Na listagem, compras no cartão mostram Compra e Fatura separadamente.

3. PARCELAMENTO
- Cada parcela fica na competência da respectiva fatura.
- purchase_date permanece como a data original da compra.
- O valor total é distribuído em centavos exatos.
- A identificação da compra passa a usar a data completa, reduzindo falsos positivos na auditoria de duplicidades.
- Duas compras iguais no mesmo mês não são tratadas automaticamente como duplicadas só por terem descrição/valor semelhantes.

4. DASHBOARD / PLANEJAMENTO
- Despesas não incluem investimentos no KPI de Despesas.
- Saldo considera receitas menos despesas e investimentos.
- Investimentos passam a aparecer corretamente como realizado no bloco Planejado × Realizado.
- O gráfico de despesas continua separado de investimentos.
- Evolução anual das receitas é mantida.

5. CONTAS
- Corrigida inconsistência entre account_type salvo no banco e type usado na interface.
- O formulário passa a ler e gravar account_type de forma consistente.

6. CARTÕES
- Cadastro passa a expor fechamento e vencimento da fatura.
- O fechamento é utilizado para sugerir a competência da fatura.

7. RECORRÊNCIAS
- A seleção de categorias também respeita o tipo da recorrência.
- Mantida a materialização em lote da V18.

8. PERFORMANCE / INTEGRIDADE
- Índices adicionados para user_id + transaction_date, user_id + purchase_date, user_id + card_id + transaction_date e categorias por usuário/tipo/nome.
- Mantido o carregamento em lote da V18.
- Mantida a proteção contra splash infinito da V18.
- Mantido o service worker com cache versionado.

BANCO SUPABASE
A V19 exige a migração:
v19_category_integrity_hardening

Ela:
- normaliza categorias legadas;
- corrige as categorias padrão;
- substitui os validadores concorrentes por um único trigger;
- cria índices de desempenho.

A coluna transactions.purchase_date já existia no banco, portanto não foi criada novamente.

PUBLICAÇÃO
1. Substitua index.html pelo index-v19.html.
2. Substitua sw.js pelo sw-v19.js.
3. Mantenha manifest.webmanifest.
4. Faça commit/push.
5. No iPhone, abra novamente o site. Se aparecer versão antiga, use aba privada ou limpe os dados do site.
