# AVIORA Mobile — Contrato Figma ↔ React V1

> **Autoridade arquitetural:** este contrato visual é subordinado a
> `AVIORA_MOBILE_FOUNDATION_BLUEPRINT_V1.md` e não reduz a matriz funcional ou
> antecipa Feature Wave.

**Gate:** 0B

**Status:** contrato para handoff; nenhum arquivo Figma foi criado ou alterado

## 1. Regra de correspondência

Nomes, variants e states devem coincidir entre Figma e React. Figma não cria token ad hoc e o código não interpreta aparência por captura. Toda exceção volta ao contrato antes da Feature Wave 1.

| Figma Component | React Component | Props essenciais | Tokens | Variants | States | Patterns consumidores |
|---|---|---|---|---|---|---|
| Button | `AppButton` | label, onPress, icon, loading, disabled | button, action, text | primary, secondary, ghost, danger | default, pressed, loading, disabled | A–E |
| IconButton | `IconButton` | icon, label, onPress, disabled | iconButton, size/icon, text | default, ghost, danger | default, pressed, disabled | A–E |
| TextField | `TextField` | label, helper, error, input props | input, text, border | single, multiline, secure | default, focus, filled, error, disabled | D |
| SearchField | `SearchField` | label, value, onChangeText | input, icon | default | default, focus, filled, disabled | A |
| Card | `Card` | children, tone | card, surface, border, elevation | default, raised | default | A–E |
| MetricCard | `MetricCard` | label, value, helper | card, typography money | default | default | B |
| StatusPill | `StatusPill` | label, tone | chip, status | neutral, positive, warning, negative, gold, info | default | A–E |
| FilterChip | `FilterChip` | label, selected, disabled | chip, action, border | default | default, selected, pressed, disabled | A |
| Notice | `InlineNotice` | title, message, tone | notice, status | info, warning, error, success | default | A–E |
| StateView | `StateView` | title, message, tone, action, loading | screen, status, icon | empty, error, offline, loading | default | A–E |
| TabBar | Expo Router `Tabs` + `AppIcon` | title, icon, route | tab, bg, border, text | five frozen tabs | default, selected | shell |
| BottomSheet | `BottomSheet` | visible, title, onClose, actions | sheet, overlay | default | open, reduced-motion | A–D |
| Dialog | `Dialog` | visible, title, onClose, actions | dialog, overlay | default | open, reduced-motion | A–D |
| ProgressBar | `ProgressBar` | value, label, showValue | progress, action | default | 0–100 | B, E |

## 2. Token naming no Figma

- Primitives: `color/neutral/1000`, `space/md`, `radius/lg`, `size/icon/md`.
- Semantic: `bg/base`, `text/primary`, `action/primary`, `status/negative`.
- Component: `button/minHeight`, `card/radius`, `sheet/padding`.

Figma variables devem preservar as três collections. Components usam Semantic/Component; Primitives só alimentam aliases.

## 3. Propriedades e estados

- nomes em inglês canônico para engenharia; copy visível em português;
- Boolean properties: `disabled`, `loading`, `selected`, `error`;
- Variant properties: `tone`, `variant`, `size` somente quando existirem no React;
- ícones usam exclusivamente nomes de `iconMap`;
- compact/medium/expanded são modes, não componentes duplicados;
- estados offline/error/blocked precisam de label, não apenas cor.

## 4. Estrutura recomendada do arquivo Figma

1. `00 Cover`
2. `01 Getting Started`
3. `02 Foundations`
4. `03 Components`
5. `04 Patterns`
6. `05 Screens — Auth`
7. `06 Screens — Core`
8. `07 Screens — Secondary`
9. `08 Playground / QA`

## 5. Ordem futura obrigatória

`Foundations → Components → Patterns → Mother Screens → Code Contract Freeze → Feature Wave 1`

Gate 0B autoriza apenas Discovery/Foundations. Mother Screens e Feature Wave 1 continuam não iniciadas.

## 6. Checklist de handoff

- variables exportáveis e sem valores soltos;
- Auto Layout em componentes e patterns;
- nomes idênticos à tabela;
- constraints para Compact/Medium/Expanded;
- touch frame 48 pt, nunca abaixo de 44 pt;
- contraste e Dynamic Type anotados;
- componentes com todos os states;
- assets da marca referenciados, não redesenhados;
- screenshots não substituem specs;
- divergência exige atualização deste contrato e aprovação antes do código.
