MENTORIA BLACK — GESTÃO FINANCEIRA V13
======================================

Arquivos desta versão
- index.html
- sw.js
- README.txt

IDENTIDADE
- Logo MB vetorial, centralizada e nítida.
- Hierarquia: símbolo acima, MENTORIA BLACK e GESTÃO FINANCEIRA abaixo.
- Mesma marca na tela de login e no sistema.
- Não depende de imagem raster para o cabeçalho.

PERÍODO
- Ano disponível de 2000 a 2100.
- Dashboard, planejamento e relatórios usam ano + mês selecionados.
- Cada combinação ano/mês tem planejamento independente.

LANÇAMENTOS
- Receita não exige categoria.
- Despesas/investimentos exigem categoria.
- Despesa exige conta OU cartão; não aceita os dois simultaneamente.
- Validação informa ao usuário exatamente o que falta antes de salvar.
- Valor aceita formatos brasileiros e internacionais comuns:
  1000
  1000,50
  1.000,50
  1000.50
  1,000.50
- Ao sair do campo, o valor é formatado para padrão brasileiro.

PARCELAMENTO
- O usuário informa o VALOR TOTAL da compra.
- Marca "Parcelar".
- Escolhe quantidade de parcelas.
- Escolhe o mês inicial do pagamento.
- O sistema cria todas as parcelas nos meses seguintes.
- A última parcela ajusta os centavos para o conjunto fechar exatamente o valor total.
- O mês inicial não pode ser anterior ao mês da compra.
- Parcelamento e despesa fixa são mutuamente exclusivos.

DESPESA FIXA
- Não existe mais a antiga pergunta "repetir mensalmente".
- Marca-se somente "Despesa fixa".
- O sistema cria a recorrência mensal.

DASHBOARD
- Despesas por categoria em colunas.
- Cada barra usa a cor cadastrada na categoria.
- Valor + percentual aparecem diretamente acima de cada barra.
- Planejado x realizado geral e por categoria.
- Cartões de crédito com resumo por cartão e total.
- Reserva de emergência reconhecida por metas, contas ou ativos contendo:
  Reserva / Emergência / Caixinha.
- Patrimônio líquido estimado.

PLANEJAMENTO
- Lazer e Conhecimento permanecem separados.
- Distribuição planejada usa as mesmas cores das categorias.
- Estratégia percentual calcula cada categoria sobre a receita planejada.

CATEGORIAS
- Criar, editar e excluir.
- Cor configurável.
- Renomear sincroniza referências existentes em lançamentos e recorrências.
- Exclusão é bloqueada quando existem dependências.

COMPATIBILIDADE
- Mantém as tabelas usadas nas versões anteriores:
  accounts, cards, categories, transactions, budgets, goals,
  recurring, assets, liabilities, monthly_plans, strategy_plans,
  rules e imports.
- Não executa migração destrutiva.

SERVICE WORKER
- Cache alterado para mentoria-black-v13 para evitar que a V12/V9 fique presa no navegador.

IMPLEMENTAÇÃO
1. Substitua index.html pelo desta versão.
2. Substitua sw.js pelo desta versão.
3. O README.txt é apenas documentação.
4. Se o repositório já possuir manifest.webmanifest, mantenha-o.
5. Depois do upload, abra o GitHub Pages e faça uma atualização forçada da página.

OBSERVAÇÃO DE TESTE
Esta entrega foi revisada estaticamente quanto a sintaxe, fluxo de interface, validações e compatibilidade com o schema documentado nas versões anteriores. A conexão real com o seu projeto Supabase/GitHub Pages depende do ambiente publicado e das políticas/tabelas existentes.
