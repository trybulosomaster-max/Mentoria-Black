MENTORIA BLACK — V40

BASE
- V39

FORMATO
- index.html
- sw.js
- README.txt

V40 — PRINCIPAIS IMPLEMENTAÇÕES
- Taxa de investimento.
- Taxa de poupança.
- Comparação com o mês anterior.
- Indicador de saúde financeira.
- Alertas orientativos do mês.
- Planejado x realizado.
- Compromissos futuros.
- Cobertura da reserva em meses.
- Busca/filtros de lançamentos mais completos.
- Proteção de categoria compatível com o tipo.
- Receita não pode usar cartão.
- Conta e cartão não podem ser usados simultaneamente.
- Categoria obrigatória.
- Preservação das regras existentes de parcelamento, recorrência,
  cartões, exclusão inteligente, investimentos e Supabase.

ARQUITETURA
- V39 foi mantida como base e a V40 foi integrada como um único módulo novo.
- Não foram adicionadas camadas V29/V30/V31/etc. como novos patches.
- O banco de dados/Supabase não exige migração para esta versão.

ROLLBACK
- Se a V40 apresentar qualquer comportamento indesejado, substitua os
  arquivos pelos 3 arquivos da V39 salvos pelo usuário.
