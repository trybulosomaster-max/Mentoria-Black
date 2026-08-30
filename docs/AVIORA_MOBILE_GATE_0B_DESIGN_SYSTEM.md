# AVIORA Mobile — Gate 0B — Design System V1

**Status:** candidato a congelamento

**Base técnica:** `feat/aviora-mobile-foundation-v1@723a39ac715aa503e73a217a2b3821dd109c2fcf`

**Plataformas:** iOS e Android

**Tema V1:** escuro preto/dourado

**Escopo:** fundação visual; nenhuma tela final da Feature Wave 1

## 1. Inventário visual Web + Mobile

| Classificação | Elementos | Decisão |
|---|---|---|
| KEEP | preto profundo, superfícies grafite, dourado de identidade/ação, hierarquia resumo→detalhe, cards, inputs, botões, toque 48, status textuais | Preservar como identidade AVIORA e base de interação. |
| ADAPT | tokens planos, tipografia numérica, pills, filtros, progressos, loading/empty/error, sombras, tab bar, safe area e teclado | Formalizar em Primitives/Semantic/Component e componentes acessíveis. |
| DEPRECATE | glyphs `⌂`, `≡`, `▦`, `◇`, `•••`; HEX locais; tipografia/radius/opacidade repetidos; `Pill` genérico em código novo | Substituir por Ionicons, tokens e nomes semânticos. `Pill` permanece apenas como alias transitório. |
| MISSING | breakpoints, `IconButton`, `SearchField`, `FilterChip`, `ProgressBar`, `BottomSheet`, `Dialog`, variants de `Screen`, contrato Figma↔React e validator visual | Incluídos no Gate 0B. |

### Web como referência, não dependência

A Web confirma a identidade preta/dourada, Inter na UI, Syncopate apenas na marca, touch mínimo de 44, raios 10–22 e espaçamento 4–32. O Mobile não importa CSS, DOM ou componentes Web e não altera nenhum arquivo Web.

## 2. Arquitetura dos tokens

Fonte canônica: `apps/mobile/src/design-system/tokens.ts`.

### 2.1 Primitives

- `color/neutral/*`, `color/gold/*`, `color/green/*`, `color/red/*`, `color/yellow/*`, `color/blue/*`;
- `space/*` em escala de 4 pontos;
- `radius/*`;
- `size/icon/*`, `size/touch/*`, `size/border/*`;
- `opacity/*`;
- `motion/duration/*`, `motion/easing/*`;
- `elevation/*`;
- famílias, tamanhos, line-heights e letter-spacing tipográficos.

### 2.2 Semantic

- `bg/base`, `bg/elevated`;
- `surface/default`, `surface/raised`, `surface/pressed`;
- `text/primary`, `text/secondary`, `text/subtle`, `text/inverse`, `text/accent`;
- `border/default`, `border/strong`, `border/focus`;
- `action/primary`, `action/primaryPressed`, `action/secondary`, `action/disabled`;
- `status/positive`, `status/negative`, `status/warning`, `status/info` com surface e border correspondentes;
- `overlay/default`;
- elevation e motion semânticos.

Status nunca depende apenas de cor: texto, label, ícone ou estado acessível acompanha o tom.

### 2.3 Component

Tokens específicos existem somente onde o semântico não basta:

- `screen/*`, `button/*`, `iconButton/*`, `input/*`, `card/*`, `tab/*`;
- `chip/*`, `notice/*`, `progress/*`, `sheet/*`, `dialog/*`;
- slots provisórios de `brand/*` e `avatar/*`.

## 3. Política de zero hardcode visual

1. Screens e componentes consomem tokens semânticos/component-level.
2. HEX/RGB/RGBA só podem existir em `tokens.ts`.
3. Exceção documentada: `app.config.ts` replica `#050505` porque o manifest/splash nativo é avaliado fora do bundle React Native e não deve importar o Design System runtime.
4. Larguras percentuais calculadas por dados (`ProgressBar`) não são tokens visuais.
5. `StyleSheet.hairlineWidth`, `flex`, percentuais estruturais e `numberOfLines` são APIs/layout, não hardcodes de identidade.

## 4. Tipografia congelada

| Estilo | Família | Peso | Size/Line | Letter spacing | Dynamic Type |
|---|---|---:|---:|---:|---|
| Display | Inter ExtraBold | 800 | 32/38 | -0.6 | sim |
| Title | Inter Bold | 700 | 26/32 | -0.6 | sim |
| Section | Inter Bold | 700 | 20/26 | 0 | sim |
| Body | Inter Regular | 400 | 16/24 | 0 | sim |
| Body Small | Inter Regular | 400 | 14/20 | 0 | sim |
| Caption | Inter Regular | 400 | 12/16 | 0 | sim |
| Money XL | Inter ExtraBold | 800 | 32/38 | 0 | sim, máx. 1.6 |
| Money L | Inter ExtraBold | 800 | 26/32 | 0 | sim, máx. 1.6 |
| Money M | Inter Bold | 700 | 16/24 | 0 | sim, máx. 1.6 |
| Button Label | Inter Bold | 700 | 15/20 | 0 | sim |
| Tab Label | Inter SemiBold | 600 | 11/14 | 0 | sim |

Valores monetários usam `fontVariant: ['tabular-nums']`. Syncopate fica restrita ao wordmark oficial; corpo, números e controles usam Inter.

## 5. Iconografia

Sistema único: **Ionicons via `@expo/vector-icons`**, mantido pelo ecossistema Expo e consistente em iOS/Android.

Contrato canônico em `icons.tsx`: `home`, `transactions`, `planning`, `patrimony`, `more`, `settings`, `search`, `filter`, `calendar`, `wallet`, `card`, `goal`, `report`, `knowledge`, `profile`, `security`, `chevron-left`, `chevron-right`, `close`, `plus`, `edit`, `trash`, `info`, `warning`, `success`, `error`.

- default: 24 pt;
- ícone compacto: 20 pt;
- alvo interativo: 48 pt;
- peso: outline para navegação/ações; filled somente se um estado selecionado futuro exigir;
- cor: token semântico;
- ícone decorativo fica oculto da árvore; ação exige `accessibilityLabel`.

## 6. Responsividade

| Modo | Faixa | Margem | Grid conceitual | Regra |
|---|---:|---:|---:|---|
| Compact | 320–599 pt | 16 | 1 coluna | cards full width |
| Medium | 600–839 pt | 24 | 8 colunas | até duas colunas; largura legível |
| Expanded | 840+ pt | 32 | 12 colunas | master/detail permitido; max-width 1120 |

`resolveResponsiveMode`, `resolveResponsiveLayout` e `useResponsiveLayout` são a única fonte para breakpoint. Layout Expanded não estica conteúdo de telefone: aplica max-width e grid conceitual.

## 7. Screen variants e sistema

| Variant | Safe area | Teclado | Scroll | Uso |
|---|---|---|---|---|
| `tab` | top/left/right + padding inferior com inset | opcional | padrão | tabs principais |
| `stack` | top/left/right + inset inferior | opcional | padrão | detalhe/navegação secundária |
| `modal` | todos os limites via overlay/insets | avoidance ativo | padrão | formulário/modal full screen |
| `auth` | top/left/right + inset inferior | avoidance ativo | padrão | login/cadastro/recuperação |

- `KeyboardAvoidingView` usa `padding` no iOS e comportamento nativo no Android.
- Scroll usa dismiss interativo/no drag e mantém taps necessários.
- Bottom padding sempre incorpora home indicator/navigation area.
- Splash só encerra após fontes essenciais e bootstrap de sessão/entitlement alcançarem estado terminal.

## 8. Acessibilidade base

- alvo absoluto: 44 pt; padrão AVIORA: 48 pt;
- botões são `Pressable`, nunca `Text onPress`;
- labels, roles e states explícitos;
- erro usa live region e descrição associada ao campo;
- progresso expõe min/max/now;
- selected/disabled/busy expostos;
- status tem texto/ícone além da cor;
- Inter suporta reflow e Dynamic Type;
- valores monetários limitam escala apenas para preservar leitura numérica;
- overlays usam `accessibilityViewIsModal`;
- reduzir movimento remove animação de sheet/dialog.

## 9. Componentes fundamentais

- `AppButton`: primary/secondary/ghost/danger, loading, disabled, ícone;
- `IconButton`: default/ghost/danger, label obrigatório;
- `TextField`: label, helper, error, multiline, ref;
- `SearchField`: busca com ícone canônico;
- `Card`: default/raised;
- `MetricCard`: valor monetário tabular;
- `StatusPill`: neutral/positive/warning/negative/gold/info;
- `FilterChip`: selected/disabled/pressed;
- `InlineNotice`: info/warning/error/success;
- `StateView`: loading/empty/error/offline e ação acessível;
- `Divider`, `PageHeader`, `SectionTitle`, `ProgressBar`;
- `BottomSheet` e `Dialog`: dismiss, safe area, reduzir movimento e ações explícitas.

## 10. Patterns oficiais

### Pattern A — List + Search + Filters

`PageHeader → SearchField → FilterChip group → count → Card list`.
Compact empilha; Medium pode usar filtros em linha; Expanded mantém lista com max-width. Loading usa `StateView`; vazio/error/offline têm texto e ação; read-only desabilita ações sem ocultar conteúdo.

### Pattern B — Summary + Sections

`PageHeader → notices → MetricCard wrap/grid → SectionTitle → sections`.
Compact: uma coluna visual; Medium: até duas; Expanded: grid 12 colunas e conteúdo limitado. Estados aparecem antes das métricas.

### Pattern C — Detail + Sticky Actions

`stack Screen → PageHeader → status/summary → sections → action area`.
Compact: ação respeita inset inferior; Medium/Expanded: detalhe com largura legível e painel secundário permitido. Loading/error preservam contexto. Read-only informa por que ações estão indisponíveis.

### Pattern D — Form

`auth/modal Screen → PageHeader → Card → TextField(s) → InlineNotice → AppButton`.
Teclado nunca cobre ação; erro foca/é anunciado pelo controle chamador; submit mostra busy e bloqueia duplicidade. Expanded não ultrapassa 760 pt.

### Pattern E — Reader

`stack Screen → PageHeader/controls → conteúdo legível → progress → navigation`.
Compact prioriza texto; Medium/Expanded limita linha e permite sumário lateral futuro. Loading, bloqueio, offline e read-only são explícitos. O reader final pertence à onda funcional posterior.

## 11. Brand assets

O Gate 0B não redesenha nem aprova assets provisórios. O futuro Figma deve fornecer slots versionados para:

- App Icon iOS;
- Adaptive Icon Android;
- splash mark;
- compact mark;
- wordmark horizontal;
- wordmark vertical;
- versão monocromática;
- safe zone e tamanhos mínimos.

A matriz oficial AVIORA já aprovada permanece a referência. O `BrandMark` atual é placeholder funcional e não vira logo definitivo por este gate.

## 12. Limites preservados

- zero mudança financeira, Web, Supabase, banco, migration, RLS, Edge ou produção;
- zero tela final da Feature Wave 1;
- zero tema claro, gráfico final, checkout, colaboração ou offline financeiro;
- Gate 0A continua obrigatório e é reexecutado integralmente no fechamento.
