# AVIORA — Matriz de cobertura E2E

Snapshot da suíte local sintética após a caracterização das áreas secundárias. Legenda: **COBERTO**, **PARCIAL**, **AUSENTE**, **N/A**.

“Coberto” descreve o ambiente sintético local, não Auth/RLS/backend ao vivo. “Parcial” normalmente significa geometria, conteúdo de fixture ou ação visível sem integração real.

| Área | Navegação | Dados | Ações | Vazio | Erro | Mobile | Desktop | Acessibilidade | Financeiro | E2E profundo |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard | COBERTO | COBERTO | COBERTO | AUSENTE | AUSENTE | COBERTO | COBERTO | COBERTO | COBERTO | COBERTO |
| Lançamentos | COBERTO | COBERTO | COBERTO sintético | AUSENTE | AUSENTE | COBERTO | COBERTO | COBERTO | COBERTO | COBERTO sintético |
| Planejamento | COBERTO | COBERTO | PARCIAL | AUSENTE | AUSENTE | COBERTO | COBERTO | COBERTO | COBERTO | COBERTO |
| Contas | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | PARCIAL | PARCIAL |
| Cartões | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO no motor | PARCIAL |
| Categorias | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | PARCIAL | PARCIAL |
| Metas | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO em unitários | PARCIAL |
| Recorrências | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO | PARCIAL |
| Patrimônio | COBERTO | PARCIAL | N/A | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | PARCIAL | PARCIAL |
| Relatórios | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO em unitários | PARCIAL |
| Saúde Financeira | COBERTO | PARCIAL | PARCIAL | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO em unitários | PARCIAL/caracterização |
| Reserva de Emergência | COBERTO | PARCIAL | AUSENTE na fixture | COBERTO sintético | COBERTO sintético | COBERTO estrutural | COBERTO estrutural | PARCIAL | COBERTO em unitários | PARCIAL/caracterização |
| Conhecimento | COBERTO | PARCIAL | PARCIAL | AUSENTE | AUSENTE | PARCIAL | PARCIAL | PARCIAL | N/A | PARCIAL |
| Minha conta | COBERTO | PARCIAL | PARCIAL | AUSENTE | AUSENTE | COBERTO | COBERTO | COBERTO | N/A | PARCIAL sem Auth |
| Administração | COBERTO OWNER / negado CUSTOMER | PARCIAL | PARCIAL | AUSENTE | AUSENTE | PARCIAL | COBERTO estrutural | PARCIAL | N/A | PARCIAL sem backend |

## Provas existentes

- Navegação, perfis e ações sintéticas: `e2e/aviora-flows.spec.mjs`.
- Realizado, Programado, Projetado, Previsão, competência e reconciliação: `e2e/aviora-financial.spec.mjs`.
- Viewports, overflow, touch, ARIA e lifecycle Chart.js: `e2e/aviora-responsive.spec.mjs`.
- Egress, storage, fixture imutável e ausência de credenciais: `e2e/aviora-isolation.spec.mjs`.
- Cartões, Categorias, Metas, Recorrências, Contas, Patrimônio, Relatórios, Saúde e Reserva: `e2e/aviora-secondary-tabs.spec.mjs`.

## Novas provas das áreas secundárias

- Cartão visível com limite, fatura derivada, fechamento/vencimento; parcela de agosto não contamina setembro e vice-versa.
- Categorias mantêm nome e cor configurada, com ação acessível e leitura não dependente só da cor.
- Meta preserva valor, progresso, prazo, estado e ausência de `NaN/Infinity`.
- Recorrência materializada substitui a projeção virtual equivalente.
- Contas e Patrimônio mostram agregados finitos.
- Relatório permanece contido em `390×844`.
- Nove áreas secundárias exercitam normal, vazio e erro sintético, mobile e desktop.
- Botões visíveis têm nome acessível; ações mobile verificadas têm alvo mínimo de 44 px.

## Lacunas que não podem ser preenchidas sem runtime/integração

1. A aba Cartões real não expõe compras do ciclo, faturas, parcelas futuras ou pagamento agregado.
2. Botões de editar/exportar/recomendar nas fixtures são intencionalmente inertes.
3. Contas, Metas, Categorias e Recorrências não executam persistência real.
4. Saúde e Reserva usam caracterização visual; não reproduzem a UI completa nem o ledger/configuração reais.
5. Conhecimento não exercita paywall, bookmarks e progresso persistido no mesmo shell sintético.
6. Minha conta não usa Auth real; Administração não usa RPC/Edge real.
7. Safe-area física, notch e teclado virtual continuam exigindo dispositivo real.
8. O helper real de sugestão de competência do cartão diverge da fixture; corrigir/testar exige próximo gate de runtime.

## Critério para aumentar “PARCIAL” para “COBERTO”

Exigir simultaneamente: UI real testável, contrato canônico documentado, ação observável, cenário normal + vazio + erro, mobile + desktop, sem egress de produção e sem usar credenciais humanas.
