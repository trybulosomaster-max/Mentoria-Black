# AVIORA Mobile V1 — Revisão crítica independente

## 1. Parecer executivo

A proposta é tecnicamente viável e coerente com a maturidade atual da AVIORA, desde que a primeira entrega seja tratada como **fundação móvel e leitura segura**, não como tentativa de portar toda a Web de uma vez.

**Parecer:** `GO_CONDITIONAL`.

Condições:

- branch isolada;
- Supabase Beta;
- nenhuma migration/RLS;
- nenhum segredo;
- nenhuma escrita financeira sensível;
- evidência iOS e Android;
- paridade financeira por fixtures;
- revisão de deep links e política de senha.

## 2. Pontos fortes

### 2.1 Backend único

A existência de um Supabase funcional reduz duplicação e permite que Web e mobile compartilhem identidade, dados, entitlement e autorização.

### 2.2 Núcleo financeiro modular

O `financial-core.js` atual já separa parte relevante de normalização e efeito financeiro. Isso cria uma rota realista de extração sem reconstrução do domínio.

### 2.3 Domínio comercial explícito

O contrato de APP, KNOWLEDGE, COMPLETE, trial e acesso interno já existe. O mobile pode adaptar esse contrato em vez de criar um segundo modelo de licença.

### 2.4 Processo de QA maduro

O projeto já opera com gates, branch isolada, testes e auditoria. Esse comportamento é particularmente importante em mobile, onde cache, sessão e versões antigas aumentam o risco.

## 3. Riscos principais

### R1 — Acoplamento Web

Parte da aplicação atual depende de globals, DOM, CSS e scripts carregados em ordem. Copiar esses arquivos para React Native seria frágil.

**Tratamento:** extrair contratos puros com fixtures; não usar WebView; não tentar importar a camada de apresentação.

### R2 — Divergência financeira durante a extração

Refatorar e “melhorar” cálculos simultaneamente torna impossível saber se uma diferença é correção ou regressão.

**Tratamento:** golden tests antes da extração; mudança funcional em PR separado.

### R3 — Política de senha divergente

A diretriz histórica mencionava uma política mais rígida, mas a `main` auditada valida mínimo de 6 caracteres.

**Tratamento:** mobile replica a `main` na fundação; endurecimento, se aprovado, deve ser aplicado simultaneamente à Web, mobile, testes, mensagens e configuração do Auth.

### R4 — Deep links de autenticação

Recuperação, confirmação e OAuth podem funcionar no navegador e falhar em build nativo se URL scheme, PKCE e redirects não estiverem alinhados.

**Tratamento:** homologar builds reais; testar app fechado, aberto, sessão ausente e link expirado.

### R5 — Cache e troca de usuário

Persistência móvel pode vazar read models do usuário anterior após logout ou troca de conta.

**Tratamento:** chaves de cache por `user_id`; limpeza obrigatória no logout e em `SIGNED_OUT`; teste A→logout→B.

### R6 — RPC privilegiada de cartões

O Security Advisor marcou funções `SECURITY DEFINER` chamáveis por usuários autenticados. A inspeção indica controles relevantes, mas não substitui teste adversarial.

**Tratamento:** leitura liberada; escrita bloqueada até matriz de ownership, replay, datas, snapshots e efeitos patrimoniais.

### R7 — Offline financeiro

Fila automática parece conveniente, mas pode duplicar pagamentos, lançamentos ou estornos.

**Tratamento:** nenhum write offline na V1; rascunho local sem efeito financeiro é aceitável.

### R8 — Gráficos

Chart.js não roda como componente nativo. Migrar visualizações pode alterar escala, legenda e acessibilidade.

**Tratamento:** começar por indicadores e listas; escolher biblioteca nativa depois de benchmark e contrato visual.

### R9 — Políticas de loja

Checkout externo e assinatura digital são temas regulatórios dinâmicos.

**Tratamento:** não incluir compra/upgrade na primeira versão; revisar regras no momento do projeto comercial móvel.

### R10 — Permissão GitHub

A integração da sessão conseguiu ler o repositório, mas recusou criação de branch e issue com 403.

**Tratamento:** pacote local aplicável; restaurar permissão antes de PR. Não escrever na `main` como atalho.


### R11 — Termos e Política de Privacidade no cadastro

O scaffold registra o aceite, mas ainda não contém URLs publicadas e versionadas para leitura dentro do fluxo móvel.

**Tratamento:** manter distribuição externa bloqueada até que Termos de Uso, Política de Privacidade, versão aceita e declarações de privacidade das lojas estejam alinhados.

### R12 — Paridade diferencial executável somente após integração

O pacote isolado não contém os três arquivos Web congelados; por isso os testes diferenciais são explicitamente marcados como `SKIP` fora do repositório real.

**Tratamento:** depois de aplicar o overlay, `npm run test:parity` deve executar sem `SKIP`, validar os Git blob hashes e comparar resultados. Qualquer mudança de hash exige nova auditoria, não atualização automática da expectativa.

## 4. Crítica da arquitetura proposta

### React Native + Expo

É a opção mais econômica para compartilhar código entre iOS e Android, sem abrir mão de experiência nativa. O risco de dependência do ecossistema Expo é aceitável porque o produto não requer, na fundação, módulos nativos incomuns.

### Expo Router

A separação por grupos públicos, protegidos e tabs facilita gate de sessão. A crítica é que redirect e hidratação podem gerar loops se o provider tiver estados ambíguos. Por isso o scaffold usa estados explícitos: `booting`, `configuration-required`, `anonymous`, `loading-access`, `granted`, `denied` e `error`.

### Supabase direto no cliente

É aceitável para leitura e auth quando RLS está correta. Não é justificativa para telas consultarem tabelas diretamente. O repositório de dados permanece obrigatório.

### Persistência de sessão

SQLite/localStorage compatível com Expo evita limites de tamanho de um item único e mantém a sessão dentro do sandbox do aplicativo, mas não equivale a armazenamento hardware-backed. Isso é aceitável apenas para a fundação Beta. Antes de distribuição pública, o projeto deve executar threat model, decidir proteção da sessão e testar migração sem logout indevido ou vazamento entre usuários. Segredos de servidor continuam fora do cliente.

## 5. Decisões que não devem ser antecipadas

- biblioteca definitiva de gráficos;
- mecanismo definitivo de cache;
- notificações financeiras;
- biometria;
- compartilhamento;
- compra dentro do app;
- suporte a desktop Web pelo mesmo bundle móvel;
- tema claro;
- alteração de política de senha.

Essas decisões dependem de evidência após a fundação.

## 6. Matriz de liberação

| Capacidade | Parecer agora | Condição |
|---|---|---|
| Shell iOS/Android | GO | build real + smoke |
| Login e sessão | GO Beta | deep links e logout validados |
| Entitlement em leitura | GO Beta | `get_my_entitlements` sob RLS |
| Dashboard em leitura | GO Beta | paridade e isolamento |
| Lançamentos em leitura | GO Beta | status/data corretos |
| Cadastro | GO Beta | política alinhada à Web |
| Iniciar trial | HOLD | decisão comercial e teste |
| Criar lançamento | HOLD | contrato e idempotência |
| Cartão/fatura write | BLOCKED | gate de segurança dedicado |
| Offline write | BLOCKED | reconciliação formal |
| Compartilhamento | BLOCKED | backend/RLS dedicado |
| Produção | BLOCKED | release gate completo |
| App Store/Play | BLOCKED | contas, legal, storage, privacidade e políticas |

## 7. Conclusão

O melhor caminho não é reduzir o escopo do produto; é ordenar o risco. A fundação entregue permite avançar visualmente e tecnicamente, ao mesmo tempo em que mantém as operações financeiras críticas fora do alcance até que existam provas suficientes.
