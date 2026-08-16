MENTORIA BLACK — V56 FINAL

BASE
- V53 completa como base funcional.
- Preserva Dashboard, Lançamentos, Planejamento, Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio, Relatórios e Saúde Financeira.

ALTERAÇÕES DA V56
1. SEPARAÇÃO DA RESERVA E METAS
- A antiga Meta chamada Reserva de Emergência/Emergência/Caixinha deixa de aparecer na aba Metas.
- Os dados não são apagados do Supabase.
- Na primeira abertura da V56, o saldo atual dessa antiga Meta é migrado uma única vez para os lançamentos próprios da Reserva.

2. NOVA CARTEIRA DE RESERVA DE EMERGÊNCIA
- A aba própria Reserva de Emergência passa a ser a fonte oficial do saldo da reserva.
- Botão “＋ Lançamento”.
- Cada lançamento possui data, descrição, tipo (Aporte/Retirada) e valor.
- Lançamentos podem ser editados ou excluídos.
- Aporte aumenta o saldo; Retirada reduz o saldo.
- Os lançamentos da Reserva não entram como despesa, receita ou investimento comum.

3. DASHBOARD
- O card “Reserva de Emergência” usa exclusivamente o saldo dos lançamentos da nova Reserva.
- A antiga Meta de Reserva não alimenta mais esse card.

4. META DA RESERVA
- “Por Gastos Fixos”: Gastos Fixos × meses.
- “Valor personalizado”: valor definido diretamente pelo usuário.
- A mesma meta é usada pela Reserva, Dashboard e Saúde Financeira.
- No modo personalizado, a equivalência em meses dos Gastos Fixos é exibida.

5. SAÚDE FINANCEIRA
- O indicador Reserva usa a mesma meta e o mesmo saldo da nova Reserva.
- A página independente continua preservada.
- Leitura e análise completa usam a mesma fonte.

6. PERSISTÊNCIA E SEGURANÇA
- A carteira de Reserva é persistida por usuário no armazenamento local, sem alterar o schema do Supabase.
- A migração da antiga Meta é protegida contra duplicação por ID.
- Nenhum registro antigo é apagado automaticamente.

ARQUIVOS
- index.html — versão completa V56.
- sw.js — cache/service worker V56.
- README.txt — documentação.

TESTE RECOMENDADO
1. Abra Metas e confirme que “Reserva de emergência” não aparece.
2. Abra Reserva de Emergência.
3. Confirme que o saldo antigo de R$ 100,00 foi migrado uma única vez.
4. Adicione um novo Aporte de R$ 500,00 e confirme o saldo de R$ 600,00.
5. Faça uma Retirada de R$ 100,00 e confirme o saldo de R$ 500,00.
6. Edite um lançamento e confirme o novo saldo.
7. Exclua um lançamento e confirme o recálculo.
8. Vá à Dashboard e confirme que o card da Reserva acompanha o saldo da nova aba.
9. Vá à Saúde Financeira e confirme que o indicador Reserva acompanha a mesma fonte.
10. Teste “Valor personalizado” e depois volte para “Por Gastos Fixos”.

IMPORTANTE
A V56 é uma versão completa. Substitua os três arquivos da versão anterior pelos três arquivos desta pasta.
