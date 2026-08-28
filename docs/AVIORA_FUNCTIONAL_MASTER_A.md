# AVIORA — Bloco Funcional Mestre A

## Escopo entregue

Este bloco aprofunda Conhecimento, Cartões, Recorrências e Patrimônio sem alterar o Visual V1, motores financeiros, Auth ou backend. A regra permanece: resumo primeiro, detalhe sob demanda.

## Conhecimento

Classificação: **IMPLEMENTADO**.

- Preferências locais por usuário/dispositivo: tema escuro, claro e confortável; tamanho; entrelinha; largura.
- Retomada: `last_section_id` continua sincronizado pelo contrato existente; posição por seção fica disponível localmente para retomada mais precisa.
- Favoritos: capítulo e ponto específico usam o RPC já existente.
- Destaques, sublinhados e notas: persistência local por usuário/dispositivo, com criação, lista, navegação, edição e exclusão.
- Busca: o RPC continua sendo a autoridade de conteúdo autorizado e o resultado é limitado à publicação aberta.
- Entitlement, amostra e paywall permanecem inalterados.

Limite conhecido: anotações não sincronizam entre dispositivos. Uma futura sincronização exige contrato de backend próprio; não foi improvisada neste bloco. TTS, régua de leitura, IA, resumo, chat, vetores e embeddings permanecem fora do escopo.

## Cartões V2

Classificação geral: **PARCIAL**.

### Implementado

- Identidade real do cartão: nome, instituição, bandeira, limite cadastrado, fechamento, vencimento e observação.
- Visão mensal por competência canônica (`transaction_date`), com Realizado, Programado, Projetado e Esperado.
- Comparação com o mês anterior.
- Compras e compromissos do período, parcelas identificáveis e compromissos persistidos futuros.
- Drill-down seguro para Lançamentos com cartão e período pré-filtrados.
- Compra cancelada é excluída; ocorrência recorrente materializada substitui a virtual correspondente.

### Pendente de contrato

- **Fatura atual/fechada/paga**: o modelo não possui entidade de fatura, estado de fechamento ou quitação agregada.
- **Limite utilizado/disponível real**: sem saldo de fatura e pagamento agregado, subtrair compras de um período produziria uma falsa disponibilidade.
- **Regra automática fechamento → competência**: o helper legado de sugestão não representa inequivocamente todos os pares fechamento/vencimento, especialmente quando o vencimento ocorre depois do fechamento no mesmo mês. A data manual e `transaction_date` continuam sendo a verdade atual.
- **Pagamento da fatura**: hoje “Pagar” materializa um lançamento individual; não existe quitação de fatura com conta de origem.
- **Séries parceladas estruturadas**: registros legados dependem de nota textual; uma série persistida canônica requer gate de contrato/persistência.

Esses pontos são **PENDENTE DE CONTRATO** e não foram mascarados por cálculos visuais.

## Recorrências

Classificação: **IMPLEMENTADO** na camada de gestão; motor **JÁ EXISTIA**.

- Filtros por status, tipo e categoria.
- Visões mensal, anual e geral.
- Totais de Realizado, Programado, Projetado, Previsão e Esperado.
- Receitas e saídas esperadas separadas.
- Detalhe da regra, próxima data, destino, status e ações existentes.
- Nenhuma mudança na geração, materialização, pausa ou exclusão.

## Absorção de capacidades históricas

| Capacidade | Classificação | Local natural | Observação |
|---|---|---|---|
| Parcelados com cartão | ABSORVIDA BEM | Cartões + Lançamentos | Cartões resume; Lançamentos mantém edição/pagamento individual. |
| Parcelados sem cartão | ABSORVIDA PARCIALMENTE | Lançamentos | Não há motivo para uma aba duplicada; falta série estruturada para gestão avançada. |
| Receitas | ABSORVIDA BEM | Dashboard + Lançamentos + Planejamento + Relatórios | Nova aba “Receitas” duplicaria filtros e totais existentes. |
| Investimentos | ABSORVIDA BEM | Planejamento + Patrimônio + Relatórios + Lançamentos | Semântica permanece separada de despesa de consumo. |
| Fatura/cartão quitado | AUSENTE | Cartões | Exige contrato de fatura/pagamento; não restaurar por DOM fictício. |

Criar abas autônomas de Parcelados, Receitas ou Investimentos agora é **NÃO RECOMENDADO**: aumentaria duplicação sem resolver os contratos ausentes.

## Patrimônio

Classificação: **IMPLEMENTADO** na leitura.

`netWorth()` já calculava contas + ativos − passivos. A tela não expunha os passivos. A composição agora mostra contas, ativos, passivos/dívidas e patrimônio líquido, além da lista de passivos existente. Nenhum cadastro novo e nenhuma fórmula foram criados.

## Relatórios

Classificação: **JÁ EXISTIA**.

Os filtros atuais já incluem cartão, conta, categoria, tipo, status, metas e períodos mensal/anual/múltiplos anos/customizado. Cartões e recorrências continuam chegando por lançamentos materializados. Projeções virtuais não são inseridas no relatório histórico para não confundir ocorrido com projeção.

## Saúde Financeira

Classificação: **PARCIAL**; contrato V2 **PENDENTE DE CONTRATO**.

A camada segura agora explica honestamente o que cada pilar atual mede e declara que o score usa somente valores realizados. Falha de cálculo não é mais apresentada como score zero/“Crítica”. Fórmula, pesos e score permanecem inalterados.

### Contrato atual caracterizado

| Pilar | Peso | Numerador / medida atual | Denominador / referência | Dado ausente |
|---|---:|---|---|---|
| Orçamento | 25% | saídas realizadas | total planejado | sem planejamento, não avaliável |
| Investimentos | 25% | investimento realizado | receita planejada | sem receita planejada, não avaliável |
| Reserva | 20% | saldo registrado | meta da reserva | sem meta, não avaliável |
| Comprometimento | 15% | Gastos Fixos realizados | 55% do total planejado como faixa-base | sem base reconhecida, não avaliável |
| Metas | 15% | média do progresso realizado | metas avaliáveis, peso igual | sem metas, não avaliável |

Os pesos disponíveis são renormalizados quando há pilares não avaliáveis. Isso pode gerar classificação forte com baixa cobertura de dados; a revisão do contrato precisa decidir como comunicar ou limitar esse caso.

### Especificação proposta para aprovação futura

Antes de implementar Saúde V2, aprovar para cada pilar:

1. **Definição humana** e horizonte: situação atual ou perspectiva do mês.
2. **Numerador e denominador canônicos**, incluindo sinais e investimento.
3. **Faixas de score** e justificativa do limiar.
4. **Dado ausente**: excluir, neutralizar ou impedir nota total.
5. **Temporalidade**: mensal, anual e histórico reconstruível.
6. **Explicação**: causa observável e ação recomendada sem inferência indevida.

Decisões pendentes:

- Orçamento deve medir apenas excesso agregado ou aderência por categoria?
- Investimento deve usar receita planejada, realizada ou esperada?
- Comprometimento representa Gastos Fixos/planejamento, Gastos Fixos/receita ou dívida/renda?
- Metas devem considerar prazo e ritmo, além do progresso?
- Deve existir um sexto pilar de liquidez/margem esperada?
- Qual cobertura mínima de dados permite exibir classificação qualitativa?

Até essas decisões, Saúde V2 é **CONTRACT_REVIEW_REQUIRED**.

## Reserva

Classificação: **JÁ EXISTIA**; sincronização **PENDENTE DE BACKEND**.

A interface e as fórmulas foram preservadas. O ledger e a configuração continuam em `localStorage`; não existe histórico cross-device. Nenhuma migration, RLS ou persistência remota foi criada.

## Fronteiras de autorização

Gates separados serão necessários para:

- contrato e persistência de faturas/pagamentos;
- séries parceladas estruturadas e migração de legados;
- sincronização de anotações do Reader;
- Saúde Financeira V2;
- Reserva cross-device.

## Integração e auditoria operacional

Antes de integração relevante, seguir o gate read-only em [AVIORA_DAILY_AUDIT_GATE.md](./AVIORA_DAILY_AUDIT_GATE.md). O snapshot de 2026-08-28 confirmou produção pública e Pages coerentes com `origin/main`, além de 44 arquivos unitários/contratuais verdes e Playwright com 153 pass, 6 skips condicionais e 0 fail nos três navegadores.

A branch visual permanece sem CI remoto próprio (`REMOTE_BRANCH_CI_ABSENT`), e a aplicação autenticada, o iPhone físico e o preview LAN foram declarados como não verificados nesta execução. Isso não autoriza presumir aprovação dessas superfícies. Integração requer diff e segurança verdes, contratos financeiros preservados, hard stops acima isolados e autorização humana explícita.
