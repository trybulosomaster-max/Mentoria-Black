# AVIORA Mobile — Visual A+B+C e Analytics Foundation

**Status:** candidato congelado para QA humana
**Baseline:** `feat/aviora-mobile-visual-refinement-1@6b07090ad32d0a5b5a116c36fdab02effaa43b7c`
**Blueprint:** `AVIORA-MOBILE-FOUNDATION-BLUEPRINT-V1-2026-08-30`
**Decisão visual:** expansão posterior do histórico `A+C` para `A+B+C`

## Fontes e autoridade

- [Contexto Operacional Atual](https://app.notion.com/p/3c92a61433ff811888ffea1d9c0fa858?pvs=204)
- [Referência Canônica de Gráficos, Tabelas e Inteligência Visual 2026](https://app.notion.com/p/3cd2a61433ff8197857ec57c8b6d278c?pvs=204)
- `docs/AVIORA_MOBILE_FOUNDATION_BLUEPRINT_V1.md`
- freeze histórico `AVIORA-VISUAL-V2-A-C-2026`

O relatório integral `AVIORA_Pesquisa_Graficos_Tabelas_2026.pdf` não estava disponível legitimamente no ambiente deste gate. A síntese canônica do Notion foi consultada; nenhum conteúdo ausente foi inferido. Contratos financeiros, backend e autorização server-side prevalecem sobre qualquer escolha visual.

## Freeze visual A+B+C

Uma única árvore React recebe tokens semânticos. O tema não altera dados, texto, ordem, ação, capability, permission ou entitlement.

| Preferência | Tema resolvido | Identidade |
|---|---|---|
| `system` | sistema claro → A; sistema escuro → C | automático |
| `serene` | A | Patrimônio Sereno |
| `white` | B | Branco Executivo |
| `dark` | C | Noite Executiva |

A e C preservam os valores do freeze anterior. B usa branco genuíno, grafite/marinho escuro, borda e sombra mínimas, dourado seletivo e turquesa semântico. O dourado interativo de B recebeu pequeno ajuste de contraste em relação ao swatch editorial antigo; isso é uma adaptação nativa acessível, não uma mudança de marca.

A preferência local migra de `light` para `serene`. `dark` e `system` mantêm a semântica. B é sempre explícito e não altera a resolução de `system`. A persistência permanece `DEVICE_LOCAL`, sem conta, banco ou sincronização.

O antigo status A+C continua válido como registro histórico. Este documento registra a decisão humana posterior que promove B a runtime. Logomarca/avatar finais e o ícone de Patrimônio permanecem `OPEN_FOR_BRAND_ICON_REVIEW`.

## Analytics foundation

`apps/mobile/src/domain/analytics/analytics-contracts.ts` é um contrato puro de apresentação. Não consulta rede, não persiste, não calcula fatos financeiros e não registra métricas sem fonte canônica.

### ChartCard

O `ChartCard` sistêmico exige:

- pergunta financeira explícita;
- período/escopo e resumo;
- estado analítico;
- plot fornecido por um consumidor autorizado;
- legenda sem depender apenas de cor;
- equivalente textual/lista/tabela acessível.

O componente não desenha série decorativa ou sintética quando faltam dados. A biblioteca de gráficos permanece **não escolhida**; a seleção exige gate próprio de compatibilidade Expo/React Native, acessibilidade, performance e manutenção.

### Metric contract e registry

O envelope cliente contempla `metricId`, `metricVersion`, `asOf`, período, escopo, série, comparação, qualidade, drill-down e equivalente acessível. O registry descreve unidade, moeda, formato, comparação permitida, permissão e disponibilidade de drill-down.

O registry nasce vazio por decisão: uma métrica só pode ser registrada quando um read model canônico assumir sua autoridade. Números da pesquisa ou do Figma nunca são dados de produto.

### Estados, tabelas e drill-down

Estados oficiais: `loading`, `empty`, `partial`, `stale`, `error`, `unauthorized` e `success`. `partial` e `stale` nunca são apresentados como sucesso completo.

A coleção analítica pode adaptar tabela para lista/cartões no layout compacto, mas preserva campos, estado, busca/filtro/ordem aplicáveis e caminho de explicação. Progressão canônica:

```text
Resumo → Comparação → Composição → Evidência
```

Realizado, Programado, Projetado e Previsão possuem rótulo, estilo de linha e marcador próprios. Cor é apenas pista adicional. Transferências, pagamentos de cartão, estornos, parcelamentos, splits, pendências e investimentos continuam sob contratos financeiros oficiais; esta camada não os reclassifica.

## Matriz de preparação da Wave 2

| Módulo | Capacidade Web / fonte canônica | Read model / Mobile atual | Necessidade A+B+C e analytics | Write / gate de segurança | Bloqueio ou próximo contrato |
|---|---|---|---|---|---|
| Metas | metas, progresso e projeções oficiais; `goals` + motor canônico | apenas totais `current/target`; tela ausente | progresso/bullet, comparação e composição acessíveis | writes somente em gate próprio com ownership | `READ_MODEL_EXTENSION_REQUIRED` para realizado, programado, projetado, cobertura, previsão e ritmo |
| Cartões | ciclos, compras, parcelas, faturas, pagamentos, créditos e estornos | configuração básica e limite; fluxo ausente | cards, linha temporal, tabela/lista e drill-down por ciclo/fatura | pagar/editar/materializar separados por write gate | `READ_MODEL_EXTENSION_REQUIRED`; preservar deduplicação de compra/pagamento |
| Recorrências | registros recorrentes e materialização oficial | ausente | lista por estado e próximos compromissos | materialização mutável/idempotente em gate próprio | `READ_MODEL_EXTENSION_REQUIRED`; não acionar materialização pela UI |
| Reserva | autoridade atual local no dispositivo Web | ausente; boundary futura prevista | resumo, progresso e estados locais claramente identificados | write local conforme contrato atual; cross-device separado | `FINANCIAL_CONTRACT_REVIEW_REQUIRED` antes de qualquer autoridade remota |
| Saúde | fórmula vigente do produto oficial | ausente | KPI explicado, composição e recomendações autorizadas | leitura; Saúde V2 fora do escopo | `READ_MODEL_EXTENSION_REQUIRED`; não criar score novo |
| Relatórios | agregações/read models oficiais | ausente | filtro → KPI → gráfico → tabela equivalente → drill-down → exportação autorizada | export/share em gates nativos; sem mutação financeira | `READ_MODEL_EXTENSION_REQUIRED` e escolha futura de biblioteca |
| Knowledge | entitlement, catálogo, reader, progresso e favoritos oficiais | ausente além do contexto de entitlement | componentes editoriais próprios; métricas não financeiras separadas | revoke/logout purgam cache; writes de progresso/favorito em gate próprio | repository/read model e cache protegido entitlement-aware necessários |
| Conta/Ajustes | Auth, access context, entitlement e preferências | shell, conta, logout e aparência presentes | A+B+C já preparado; estados de acesso permanecem comuns | sem grant/trial/role no cliente | secure storage nativo de produção continua gate próprio |

### Gaps protegidos

- O snapshot Mobile ainda não oferece séries temporais, relatórios completos, ciclo/fatura ou todas as distinções entre Programado, Projetado e Previsão.
- Reserva ainda exige decisão sobre autoridade futura; seu estado local atual não será promovido a remoto por conveniência.
- Relatórios exigem o mesmo dataset para KPI, gráfico, tabela e drill-down.
- Qualquer ausência ou ambiguidade de verdade financeira deve resultar em `FINANCIAL_CONTRACT_REVIEW_REQUIRED`, não em cálculo paralelo.
- Toda extensão de read model passa por port/repository, preserva `AccessContext`, ownership, RLS e cache particionado.

## Ordem recomendada para Wave 2

1. congelar os read models e testes diferenciais por domínio;
2. Metas em leitura, usando somente métricas canônicas;
3. Cartões e Recorrências em leitura, com semântica de ciclo e deduplicação comprovadas;
4. fronteira de Reserva conforme autoridade atual, sem cross-device;
5. Saúde vigente em leitura, sem Saúde V2;
6. Relatórios sobre dataset canônico único e biblioteca aprovada em gate separado;
7. Knowledge/Reader com entitlement e cache protegido;
8. writes por família, cada um sob autorização, idempotência, ownership e regressão próprios.

Open Finance, IA, importadores, Sharing, Saúde V2, Reserva cross-device, writes offline e notificações inteligentes não foram iniciados.
