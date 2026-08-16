MENTORIA BLACK — V60 FINAL

BASE
- V59 FINAL como base funcional.
- A V60 preserva os módulos e dados existentes da V59.
- Não altera schema/migração do Supabase.
- Nenhum lançamento antigo é apagado.

ARQUITETURA V60
- index.html carrega a base V59 fixada no commit 9841e59c244fe941f8fd8fd20c7b82c4277f97c7 e aplica a camada v60.js.
- v60.js concentra as melhorias funcionais.
- sw.js usa cache V60 e força a atualização da aplicação.
- manifest.webmanifest permanece o mesmo da V59.

1. DASHBOARD
- Mantém os indicadores existentes.
- Não exibe a Saúde Financeira completa.
- Exibe somente um acesso rápido para abrir Saúde Financeira.
- Não duplica o conteúdo completo de Reserva/Saúde.
- Patrimônio não exibe Reserva de Emergência como ativo duplicado.

2. SAÚDE FINANCEIRA
Visões disponíveis:
- Mês
- Ano
- Mês × Mês
- Ano × Ano
- Histórico / Geral

A nota é recalculada para cada período a partir dos indicadores financeiros brutos.
Não é feita média simples das notas de períodos.

Inclui:
- Saúde financeira
- Orçamento
- Investimentos
- Reserva
- Metas
- Evolução financeira
- Alertas financeiros
- Prioridade financeira
- Conquistas financeiras
- Taxa de Construção Financeira

3. TAXA DE CONSTRUÇÃO FINANCEIRA
- Percentual da receita direcionado à construção patrimonial.
- Considera investimentos e aportes líquidos da Reserva.
- Não considera despesas comuns nem metas de consumo como construção.
- Mostra percentual, valor direcionado, base de receita, investimentos e reserva líquida.
- Possui classificação e evolução histórica.

4. RESERVA DE EMERGÊNCIA
Mantém a carteira própria da V56/V59 como fonte oficial.
Inclui as visões:
- Mês
- Ano
- Mês × Mês
- Ano × Ano
- Histórico / Geral

Mostra:
- saldo atual
- aportes
- retiradas
- evolução líquida
- cobertura em meses
- progresso da meta
- evolução histórica
- marcos de 25%, 50%, 75% e 100%
- projeção/meta existente na configuração

A regra de Gastos Fixos permanece:
- média dos 6 meses completos anteriores ao período selecionado;
- o mês selecionado não entra na média;
- modo "Valor personalizado" permanece independente;
- aviso quando houver menos de 6 meses com dados reconhecidos.

5. RELATÓRIOS
- Usa a mesma metodologia da Saúde Financeira.
- Possui Mês, Ano, Mês × Mês, Ano × Ano e Histórico/Geral.
- Mostra receitas, saídas, saldo, investimentos, saúde e construção financeira.
- A impressão/PDF usa o mesmo motor da tela de Relatórios.

6. PRESERVAÇÕES
- Lançamentos
- Parcelamentos
- Recorrências
- Cartões
- Contas
- Categorias
- Planejamento
- Metas
- Patrimônio
- Supabase por usuário
- Reserva própria da V56/V59
- Regras de segurança e compatibilidade já existentes

7. PUBLICAÇÃO
Arquivos:
- index.html
- v60.js
- sw.js
- README.txt

Mantenha:
- manifest.webmanifest

IMPORTANTE
O index.html da V60 usa a V59 oficial fixada no commit anterior para preservar a base funcional enquanto a camada V60 adiciona as melhorias.


V60 — CONSOLIDAÇÃO
- Base V59 incorporada diretamente no index.html; não depende de fetch remoto da V59.
- Melhorias V60 incorporadas diretamente no index.html.
- Mantido o padrão de exatamente 3 arquivos: index.html, sw.js e README.txt.
- Nenhuma migração/schema do Supabase.
