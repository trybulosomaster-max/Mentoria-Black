# AVIORA — Auditoria para o próximo gate

Escopo auditado no commit `9877654dd1af96e0e9d2236a7b12b108c501a293`. Este documento registra comportamento existente e propostas; não altera runtime, fórmula financeira, Auth, Administração ou backend.

## Resumo executivo

- **Cartões:** o modelo já guarda limite, fechamento e vencimento, e os lançamentos separam compra de competência da fatura. A tela do produto, porém, mostra apenas gastos do período por cartão. Não há entidade de fatura, pagamento agregado da fatura, ciclo fechado nem próximas faturas consolidadas.
- **Saúde Financeira:** a fórmula atual tem cinco pilares e pesos explícitos, mas avalia somente o realizado, renormaliza pilares ausentes e pode apresentar uma classificação forte com poucos dados. Há inconsistências de linguagem e fallbacks que precisam de correção controlada.
- **Reserva:** saldo, meta, cobertura e progresso têm fórmulas identificáveis, mas o ledger/configuração ficam no navegador e há múltiplas fontes concorrentes. Ano/mês altera a base de gastos, não o saldo acumulado nem a lista inteira.
- **Identidade:** dois JPGs AVIORA estão ativos. Os oito assets Meridian são legados. Favicon e Apple icon reutilizam uma imagem grande sem variante dedicada. O wordmark efetivo diverge da fonte sugerida pelo CSS base.
- **E2E:** a nova caracterização aprofunda nove áreas secundárias sem inventar comportamento. Botões inertes, integrações reais e estados específicos continuam marcados como parciais.

## Cartões

### Modelo e contratos existentes

| Capacidade | Estado | Evidência e leitura atual |
|---|---|---|
| Nome, instituição, bandeira, limite, fechamento, vencimento e nota | VALIDADO/PARCIAL | `public.cards` possui esses campos em `supabase/migrations/20260820161844_local_v81_structural_baseline.sql:25-35`, mas o schema não limita fechamento/vencimento a 1–31; essa validação existe apenas no formulário. |
| Vínculo de lançamento/recorrência ao cartão | VALIDADO | FKs compostas preservam `card_id + user_id` em `supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql:159-183`. |
| Edição de limite, fechamento e vencimento | VALIDADO | O formulário V19 lê e persiste os três campos em `index.html:1662-1664`. |
| Compra versus competência da fatura | VALIDADO | `purchase_date` guarda a compra e `transaction_date` a competência/fatura em `index.html:1566-1586`. O motor mensal usa `transaction_date`. |
| Parcelamento | VALIDADO | As parcelas são registros mensais independentes, com centavos reconciliados na última parcela e nota `Parcelado X/N`, em `index.html:1598-1611`. |
| Recorrência vinculada ao cartão | VALIDADO | A regra persiste `card_id` e começa no mês seguinte em `index.html:1626-1634`. |
| Pagamento de compra pendente | VALIDADO | `markPaid` muda somente o lançamento selecionado para `realizado`, em `index.html:716-722`. |
| Soma por cartão no período selecionado | VALIDADO | `cardSummary` soma despesas/investimentos não cancelados do mês por `card_id`, em `index.html:640-642`. |
| Tela Cartões atual | PARCIAL | `cards()` exibe somente gasto do período por cartão e total, em `index.html:789`. Limite, fechamento, vencimento e botões de editar/excluir para cartões existentes não aparecem; `openCard(id)` existe, mas não é acionável pela lista. |
| Fatura atual | AMBÍGUO | Não existe tabela/objeto de fatura. O valor é derivado de lançamentos cuja `transaction_date` cai no período; não há estado aberta/fechada/paga. |
| Limite utilizado/disponível | NÃO EXPOSTO NA UI | O limite existe, mas não há contrato único para qual ciclo compõe o utilizado; subtrair o mês selecionado pode não representar o ciclo real. |
| Pagamento agregado da fatura | NÃO IMPLEMENTADO | Não existe operação que liquide uma fatura e reconcilie suas compras como conjunto. Há apenas pagamento de cada lançamento. |
| Compras do ciclo e drill-down | NÃO EXPOSTO NA UI | Os lançamentos permitem filtrar por cartão internamente, mas a aba Cartões não oferece a lista/drill-down. |
| Parcelas futuras/próximas faturas | NÃO EXPOSTO NA UI | Os dados podem ser agrupados por `transaction_date`, porém nenhuma visão os apresenta. |

### Divergência objetiva de competência

`v19SuggestedBillingDate` sempre desloca a compra em um mês antes do fechamento e em dois meses depois dele (`index.html:1376-1385`). Para um cartão com fechamento 22 e vencimento 30:

- compra em `20/08` sugere `30/09`;
- compra em `23/08` sugere `30/10`.

A fixture homologada modela a compra de `20/08` na competência `30/08` (`e2e/fixtures/aviora-synthetic-fixture.js:28,36`). Portanto, a fixture prova o motor **depois que `transaction_date` já existe**, mas não prova o helper real que sugere essa data. Classificação: **BUG/CONTRATO DIVERGENTE**. O próximo gate deve primeiro fixar a regra de ciclo e criar teste direto do helper; este bloco não altera runtime.

### Outros riscos funcionais encontrados

- **Parcelas sem identidade estruturada:** o schema oferece `installment_series_id` e `installment_number`, mas a UI grava somente texto em `note`. A proteção de unicidade do banco não cobre parcelas criadas pelo frontend; a deduplicação passa a depender de regex/texto (`index.html:1412-1426,1598-1609`).
- **Exclusão cruzada de parcelas:** o agrupamento de exclusão usa total de parcelas + data da compra, sem cartão e descrição. Duas compras distintas no mesmo dia e com o mesmo número de parcelas podem ser agrupadas (`index.html:2015-2029`). Classificação: **BUG com potencial destrutivo**, para gate próprio e teste antes da correção.
- **Status futuro divergente:** parcelas novas herdam o status do formulário, cujo padrão é `realizado`. O motor reclassifica data futura como Programado, mas a tabela e o botão `Pagar` leem o status bruto. A mesma parcela pode ser prospectiva no cálculo e “Realizada” na UI.
- **Pagamento não quita fatura:** marcar como pago atualiza apenas o status do lançamento; não seleciona conta, não cria movimento de quitação nem relaciona compras a um pagamento.
- **Conta + cartão ambíguos:** a UI tenta manter XOR, porém o schema não impõe essa regra e existem fixtures legadas com os dois vínculos. Isso pode debitar conta antes da quitação da fatura.
- **Recorrência no cartão sem ciclo:** `next_date` vira diretamente a competência; não há aplicação explícita de fechamento/vencimento nem `purchase_date`.
- **Dashboard parcial:** os KPIs gerais usam o motor canônico, mas o resumo específico de cartões soma somente transações materializadas do período e mistura realizado/pendente; projeções virtuais por cartão não entram.

O E2E adicionado neste bloco é deliberadamente sintético: confirma o cartão da fixture e os buckets do motor, mas não afirma que o helper/formulário real está correto.

### Proposta segura para o próximo gate

1. Cabeçalho do cartão: nome, instituição, limite total, fechamento e vencimento.
2. Resumo do ciclo, somente após fechar o contrato de competência:
   - utilizado no ciclo;
   - disponível no ciclo;
   - fatura/compromisso atual derivado;
   - data de fechamento e vencimento.
3. Drill-down por `card_id` e competência, com compra, parcela, categoria, status e valor.
4. Próximas competências por `transaction_date`, distinguindo parcelas de compras novas.
5. Ação `Pagar` somente em lançamentos aplicáveis. Não chamar isso de “pagar fatura” enquanto não houver operação agregada canônica.
6. Reutilizar Dashboard, Planejamento e Lançamentos como consumidores do mesmo view-data; não criar uma segunda soma no DOM.

## Saúde Financeira

### Fórmula atual

Pesos definidos em `js/health-integration.js:10`:

| Pilar | Peso | Fórmula efetiva | Horizonte |
|---|---:|---|---|
| Orçamento | 25% | 100 enquanto saídas realizadas não excedem o total planejado; cai pelo excesso | mês selecionado, realizado |
| Investimentos | 25% | investimento realizado / receita planejada × 100 | mês selecionado, realizado |
| Reserva | 20% | saldo da reserva / meta da reserva × 100 | saldo/meta atuais |
| Comprometimento | 15% | gastos fixos realizados contra limiar de 55% do total planejado | mês selecionado, realizado |
| Metas | 15% | média simples do progresso realizado das metas não-reserva | cumulativo atual |

Evidências: `js/health-integration.js:17-32`. Programado e Projetado não alteram a nota oficial; isso é testado em `tests/health-canonical-v82.test.js`.

Quando algum pilar não é avaliável, o peso dos demais é renormalizado. Com apenas um pilar, uma nota `100/Excelente` é possível. Sem qualquer pilar, a nota é `null`/“Dados insuficientes”. As faixas são: Crítica `<40`, Atenção `<60`, Regular `<75`, Boa `<90`, Excelente `>=90`.

### Riscos de interpretação

1. O fallback de exceção retorna `0/Crítica`, fazendo falha técnica parecer diagnóstico (`index.html:2696-2700`).
2. Recomendações podem comparar componente `null` como número e sugerir ação sem base (`index.html:2706-2725`).
3. “Análise completa” sobrepromete quando a avaliação é parcial (`index.html:2729-2778`).
4. “Constância” e “Comprometimento” não descrevem as fórmulas reais.
5. A UI não deixa explícito que a nota mensal usa somente o realizado.
6. O “principal ponto de atenção” tem ordem fixa, não seleciona necessariamente o pior pilar.

### Especificação proposta

- Frase principal: “Sua saúde financeira está **Boa**, com avaliação de **4 de 5 pilares**.”
- Complemento causal: “Sua margem caiu porque os gastos fixos realizados aumentaram.”
- Cada pilar mostra: valor, fórmula humana, causa, dado ausente e ação recomendada.
- Separar **Situação atual (realizado)** de **Perspectiva do mês (compromissos conhecidos)**; a perspectiva não altera a nota oficial sem decisão financeira própria.
- Mensal: cinco pilares, cobertura de dados e comparação com mês anterior.
- Anual: série dos pilares mensais; não tirar média cega de notas parciais.
- Histórico: guardar cobertura de dados e fórmula/versão usada em cada período.
- Comparação entre anos: pilares equivalentes e cobertura semelhante; sinalizar quebra de contrato quando a fórmula mudar.

Histórico fiel exigirá fonte versionada para planejamento, reserva e configurações. Isso é decisão futura de backend e não deve ser improvisado no frontend.

## Reserva de Emergência

### Fórmulas e fontes

- **Saldo:** soma do ledger, aportes positivos e retiradas negativas, sem filtro por data (`index.html:2822-2852`).
- **Gastos Fixos:** média dos seis meses completos anteriores ao período, somente despesas realizadas na categoria exata “Gastos Fixos” (`js/health-integration.js:13-14`; `index.html:2986-2999`).
- **Meta fixa:** média de gastos fixos × meses configurados, padrão 6 e mínimo 0,5.
- **Meta personalizada:** valor informado pelo usuário.
- **Falta:** `max(0, meta - saldo)`.
- **Cobertura:** `saldo / média mensal de gastos fixos`.
- **Progresso:** `saldo / meta`, limitado visualmente a 100%.
- **Aporte aproximado:** falta dividida pelo número aproximado de meses até o prazo.

`Progresso` significa, portanto, progresso da **própria Reserva de Emergência contra o target da reserva**. Não é progresso de metas gerais.

### Inconsistências registradas

1. O modal de configuração usa gastos fixos do mês, enquanto a página final usa média de seis meses (`index.html:2853-2864,2898-2911,3015-3022`).
2. A análise completa pode usar o target V56 antigo, diferente da página V58 (`index.html:2412-2414,2928-2933`).
3. No modo personalizado, a Saúde reconstrói “gastos fixos” como `target/months`, podendo divergir da média real.
4. Dashboard/Saúde/Reserva usam o ledger local, enquanto Patrimônio ainda usa metas/contas/ativos reconhecidos pelo nome (`index.html:820,2165-2188,3267`).
5. Ledger e settings são `localStorage`, não sincronizam entre dispositivos e não formam histórico auditável.
6. Ano/mês muda a base de gastos, mas saldo e lançamentos continuam globais; a UI não explica isso.

### Linguagem

| Termo atual | Classificação | Próxima redação sugerida |
|---|---|---|
| Gastos Fixos | CLARO, mas falta explicar a média | “Média mensal de gastos fixos (6 meses)” |
| Meta | AMBÍGUO entre fixa/custom | “Meta da reserva” + subtítulo da regra |
| Falta | CLARO | “Falta para atingir a meta” |
| Cobertura | TÉCNICO sem unidade | “Meses de gastos fixos cobertos” |
| Progresso | AMBÍGUO sem alvo | “Progresso da meta da reserva” |

### Próxima estrutura

- **Atual:** saldo registrado, meta, falta, meses cobertos e aporte necessário.
- **Evolução anual:** aportes, retiradas, líquido e saldo de fechamento por mês.
- **Histórico:** ledger por período com saldo inicial/final. Valores futuros não entram no saldo “atual”.
- O filtro deve explicitar se altera a base de gastos, a lista do ledger ou ambos.
- Até haver persistência canônica, chamar o valor de “saldo registrado neste dispositivo”.

## Identidade AVIORA

| Uso | Classificação | Observação |
|---|---|---|
| `assets/branding/aviora-official.jpg` | OFICIAL ATUAL | Símbolo ativo, usado também como crest, capa, favicon e Apple icon. |
| `assets/branding/aviora-login-hero.jpg` | OFICIAL ATUAL | Hero ativo; o mesmo arquivo recebe overlays de dia/noite. |
| `assets/branding/mentoria-black-icon-512.png` | LEGADO/EDITORIAL ESPECÍFICO | Usado apenas no preview autônomo de Conhecimento. Não é marca global. |
| Quatro `meridian-day/night-*.png` | LEGADO VISUAL | Apenas preview Meridian autônomo. |
| Quatro `meridian-black-*.jpg` | LEGADO VISUAL | Sem referência executável encontrada. |
| Classes e JS `meridian-*` | LEGADO INTERNO INOFENSIVO | Mantidos por compatibilidade; não devem ser renomeados só por estética. |
| Favicon/apple-touch/manifest | PRECISA REFINAMENTO | Reutilizam JPG 1254×1254; não há ícone dedicado ou `maskable`. |

Discrepância: o CSS Meridian sugere `Meridian Syncopate`, mas `assets/aviora-v82.css`, carregado depois, define Avenir no mesmo wordmark. Os testes atuais procuram strings, não o computed style. Próximo gate deve decidir conscientemente a fonte de assinatura.

Mapa futuro:

- assinatura completa: `AVIORA` + `GESTÃO FINANCEIRA`;
- assinatura compacta de header: símbolo + `AVIORA`;
- símbolo isolado: águia oficial sem texto;
- favicon/app icon: arquivo quadrado dedicado, incluindo variante maskable;
- login hero: composição oficial separada do ícone.

## Leitura visual das áreas secundárias

Foram capturadas, em modo somente leitura, versões desktop e `390×844` de Contas, Cartões, Categorias, Metas, Recorrências, Patrimônio, Relatórios, Reserva e Saúde. A evidência visual reforçou estes pontos para o próximo gate:

- **Cartões:** a fixture parece pronta e informativa, mas é mais rica que a tela real; limite, fatura e ações mostrados no preview não constituem prova de disponibilidade no produto.
- **Categorias:** nomes e cores configuradas estão presentes, porém o marcador é visualmente discreto demais no mobile. A próxima melhoria pode aumentar área/contorno sem trocar a cor escolhida.
- **Recorrências:** a leitura em cards funciona sem overflow, mas quatro regras já produzem uma página alta; resumo, filtro e detalhe sob demanda terão valor antes de escalar a lista.
- **Metas, Contas, Patrimônio e Relatórios:** a hierarquia sintética permanece legível e sem cortes; ações visíveis têm alvos adequados, mas persistência e estados reais continuam fora da prova.
- **Saúde e Reserva:** o preview atual é propositalmente uma caracterização curta. Ele não demonstra a densidade, os fallbacks nem as divergências de fontes encontradas no runtime real.

As imagens não foram versionadas: são artefatos locais de auditoria, sem dados reais, usados apenas para sustentar estas conclusões.

## Autocorreção futura

Fluxo proposto:

`detectar → classificar → reproduzir → avaliar política → gerar patch isolado → testar → comparar diff → reverter se falhar → relatar`

Auto-fix permitido somente para CSS, overflow, overlap, espaçamento, ARIA simples, texto aprovado e apresentação sem lógica de negócio. Financeiro, Auth, segurança, permissões, Supabase/RLS/migrations, Edge, Kiwify, Administração crítica e operações destrutivas ficam obrigatoriamente em `detectar → reproduzir → diagnosticar → reportar → parar`.

Cada patch automático deve ter allowlist de caminhos, orçamento máximo de diff, backup/reversão, testes direcionados e proibição explícita de `main`/produção.

## Prioridades recomendadas para o próximo gate

1. Fechar o contrato de competência de cartão e corrigir/testar o helper divergente.
2. Projetar a aba Cartões a partir de lançamentos existentes, sem inventar entidade de fatura.
3. Unificar as fontes de Reserva antes de prometer histórico ou sincronização.
4. Corrigir fallbacks e linguagem de Saúde sem mudar pesos silenciosamente.
5. Decidir fonte/variantes oficiais da assinatura e criar ícones dedicados.
6. Ampliar fixtures E2E somente quando a UI real oferecer ações verificáveis.
