MENTORIA BLACK — V60 FINAL

BASE
- V59/V58 oficial preservada como base funcional.
- Mantém Dashboard, Lançamentos, Planejamento, Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio, Relatórios, Reserva de Emergência e Saúde Financeira.
- Mantém a carteira própria da Reserva de Emergência.
- Não altera schema nem migração do Supabase.

V60 FINAL — IMPLEMENTAÇÕES
1. DASHBOARD ENXUTA
- Mantém indicadores executivos.
- Retira análises detalhadas de Receitas, Cartões, Investimentos e Planejado × Realizado da Dashboard.
- Mantém acesso rápido à Saúde Financeira.
- Mostra somente quando necessário metas alcançadas que aguardam baixa.

2. SAÚDE FINANCEIRA
- Mês, Ano, Mês × Mês, Ano × Ano e Histórico/Geral.
- Evolução financeira.
- Alertas financeiros.
- Prioridade financeira.
- Conquistas financeiras.
- Taxa de Construção Financeira com classificação.
- Comparações recalculam cada período separadamente.

3. RESERVA DE EMERGÊNCIA
- Mesma metodologia de períodos.
- Evolução, aportes, retiradas, cobertura, progresso, meta e marcos.
- Média de Gastos Fixos baseada nos 6 meses completos anteriores.

4. METAS
- Meta manual, parcelada ou recorrente.
- Progresso, acumulado, objetivo, falta, aporte e previsão.
- Acompanhamento por lançamentos da categoria Metas.
- Metas realizadas deixam de aparecer na lista ativa.
- Meta alcançada pode receber baixa na própria aba e pela Dashboard.
- Metadados da evolução são persistidos localmente por usuário para evitar alteração de schema.

5. RECORRÊNCIAS
- Aba própria com visão Mês, Ano e Geral/Histórico.
- Filtro por categoria.
- Totais de registros, receitas, despesas, ativas e pausadas.

6. PARCELADOS
- Nova aba própria.
- Agrupamento das séries parceladas.
- Filtros Mês, Ano, Geral e categoria.
- Parcela atual, total, progresso e parcelas restantes.

7. RECEITAS
- Nova aba própria.
- Mês, Ano e Geral/Histórico.
- Filtro por categoria.
- Evolução e registros.

8. INVESTIMENTOS
- Nova aba própria, separada de Patrimônio.
- Mês, Ano e Geral/Histórico.
- Filtro por categoria.
- Planejado × realizado, diferença, execução e evolução.
- A categoria padrão é INVESTIMENTOS; a nomenclatura antiga Liberdade Financeira deve ser tratada como Investimentos na apresentação quando aplicável.

9. RELATÓRIOS
- Impressão/PDF por módulo.
- Metas, Recorrências, Parcelados, Receitas, Investimentos, Reserva e Saúde Financeira.
- Filtros de período Mês, Ano e Geral/Histórico.
- Os registros impressos usam a mesma base dos módulos.

10. ARQUIVOS
- index.html — aplicação completa V60 FINAL.
- sw.js — Service Worker/cache V60 FINAL.
- README.txt — documentação.
- Nenhum manifest ou quarto arquivo é necessário.

PUBLICAÇÃO
- Substitua os três arquivos da versão anterior pelos três arquivos desta versão.
- Não altere o schema do Supabase.
- Faça uma atualização forçada/limpe o cache antigo se o navegador continuar mostrando a versão anterior.
