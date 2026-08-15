MENTORIA BLACK — V50

BASE EXCLUSIVA
- V39 oficial enviada pelo usuário.
- Nenhum código da V40 anterior foi usado como base.
- Nenhuma alteração de schema/migração do Supabase.

IMPLEMENTADO
1. Reserva de Emergência
- Meta em meses definida pelo usuário; sugestão inicial de 6 meses.
- Cálculo exclusivamente por Gastos Fixos.
- Cobertura atual em meses.
- Meta em dinheiro.
- Progresso.
- Valor que falta.
- Prazo opcional.
- Aporte mensal aproximado para o prazo.
- Recalcula automaticamente quando os Gastos Fixos mudam.

2. Saúde Financeira
- Nota orientativa 0–100.
- Cinco pilares: orçamento, investimentos, reserva, comprometimento e metas.
- Faixas Crítica/Atenção/Regular/Boa/Excelente.

3. Inteligência Black
- Explicação personalizada dos indicadores.
- Mostra pontos positivos, principal ponto de atenção e próxima ação.
- Não altera nenhum cálculo nem dado.

NOTA SOBRE IA
A V50 entrega a camada de interpretação inteligente localmente, sem expor chave de API no navegador. Uma IA externa (OpenAI ou outro provedor) só deve ser conectada posteriormente por um endpoint seguro/Edge Function; não foi inventada uma integração insegura nem uma chave dentro do frontend.

PRESERVADO DA V39
- Lançamentos, receitas, despesas, investimentos e resgates.
- Liberdade Financeira como investimento.
- Parcelamentos e primeira fatura.
- Parcelas restantes.
- Recorrências.
- Exclusão somente esta / futuras / todas.
- Status antes de Mais opções.
- Busca/filtros.
- Planejamento.
- Patrimônio.
- Supabase e autenticação.

ROLLBACK
- Restaurar os arquivos da V39 oficiais.
