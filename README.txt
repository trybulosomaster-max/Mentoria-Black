Mentoria Black — V30

Pacote final com 3 arquivos:
- index.html
- sw.js
- README.txt

V30 — CORREÇÕES CONSOLIDADAS APÓS AUDITORIA DA V31

1. RESERVA DE EMERGÊNCIA
- Corrigida a identificação de Reserva / Emergência / Caixinha.
- Evita dupla contagem quando a mesma reserva aparece como meta + conta/ativo.
- Prioriza a conta/caixinha ou ativo efetivamente reservado para o saldo atual.
- A meta continua sendo usada para objetivo e progresso.
- O Dashboard mostra a fonte identificada (ex.: conta/caixinha cadastrada).

2. INVESTIMENTOS
- Investimentos continuam separados de despesas.
- Dashboard passa a mostrar um bloco próprio de Investimentos.
- O bloco compara Planejado x Realizado x Diferença no período.
- O cálculo de realizado usa lançamentos do tipo investimento.
- A comparação por categoria do planejamento continua tratando Investimentos como categoria própria.

3. STATUS DO LANÇAMENTO
- Status foi retirado de “Mais detalhes”.
- Status agora aparece diretamente antes de “Mais opções”.
- Opções: Realizado, Pendente e Cancelado.
- O campo continua sendo salvo normalmente na tabela transactions.

4. MAIS OPÇÕES
- O grupo foi renomeado para “Mais opções”.
- Continua contendo somente informações complementares, sem esconder o Status.

5. FUNCIONALIDADES DA V31 PRESERVADAS
- Receita pode ser parcelada.
- Receita pode ser recorrente.
- Receita pode usar parcelamento + recorrência juntos.
- Receita exige conta e não permite cartão de crédito.
- Parcelamento usa valor TOTAL, quantidade de parcelas e primeiro lançamento/fatura.
- Última parcela recebe ajuste exato de centavos.
- Despesa fixa continua separada do parcelamento.
- Exclusão inteligente de parcelas/recorrências preservada.
- Cartões, planejamento, categorias, metas, patrimônio e relatórios preservados.
- Planejado x realizado por categoria inclui Investimentos corretamente.

CACHE
- Service Worker atualizado para V30.
- Caches anteriores são removidos na ativação.
- O registro do Service Worker usa updateViaCache:none e versão V30.

PUBLICAÇÃO
1. Substitua index.html pelo desta V30.
2. Substitua sw.js pelo desta V30.
3. Mantenha manifest.webmanifest.
4. Faça commit dos arquivos.
5. Abra o sistema novamente e faça uma atualização completa se necessário.

TESTE RECOMENDADO
1. Dashboard: confirme Reserva de emergência e a fonte da reserva.
2. Dashboard: confirme o bloco Investimentos com Planejado, Realizado e Diferença.
3. + Novo lançamento: confirme Status antes de “Mais opções”.
4. Abra “Mais opções” e confirme que Status não está mais dentro dele.
5. Receita: confirme parcelamento e recorrência.
6. Receita parcelada: confirme soma exata do valor total.
7. Planejamento: confirme Investimentos no planejado x realizado.
8. Atualize o navegador e confirme que o V30 permanece carregado.
