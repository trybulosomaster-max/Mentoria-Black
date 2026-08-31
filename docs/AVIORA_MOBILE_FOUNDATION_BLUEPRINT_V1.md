# AVIORA Mobile — Foundation Blueprint V1

**Status:** `FROZEN`
**Freeze ID:** `AVIORA-MOBILE-FOUNDATION-BLUEPRINT-V1-2026-08-30`
**Baseline oficial:** `origin/main@e37a388b486518a5abb9dafc763b394dc8961de1`
**Plataformas:** iOS e Android
**Escopo deste freeze:** arquitetura, contratos, fronteiras e gates; nenhuma Feature Wave

## 1. Propósito

Definir a fundação evolutiva do AVIORA Mobile sem criar um segundo produto financeiro. O Mobile final deve possuir paridade funcional integral com as capacidades oficiais aplicáveis ao papel autenticado, adaptando interação e navegação ao dispositivo sem reduzir capacidade.

Este documento substitui como autoridade corrente `AVIORA_MOBILE_BLUEPRINT_V1.md` e `AVIORA_MOBILE_SPEC_FREEZE_V1.md`. Esses arquivos permanecem no repositório como registros históricos.

## 2. Baseline auditada

- produto oficial: Web em `origin/main@e37a388b486518a5abb9dafc763b394dc8961de1`;
- backend canônico: Supabase existente, sob Auth, RLS, views e RPCs;
- fundação candidata reconciliada: Expo/React Native, TypeScript estrito e Expo Router;
- financeiro Mobile atual: leitura parcial, nunca paridade final;
- contratos diferenciais atuais: núcleo financeiro básico, acesso/comercial e cadastro;
- nenhuma mudança de banco, RLS, Edge Function, Web ou produção integra este freeze.

### 2.1 Rastreabilidade da reconciliação

| Commit original | Commit reconciliado | Classificação |
|---|---|---|
| `19ec79762b6d93a2732f1de03930945ddeeab99a` | `ccda77e838ea4f3da8fc524eaa2b5997bba3bea0` | ADAPT |
| `f12bcd073bd580daf11112608f430cda93045332` | `01c581c9cbdb672b2c87c45197158dd73a5a0180` | ADAPT |
| `723a39ac715aa503e73a217a2b3821dd109c2fcf` | `f626cc792230c83c56072e514022cca4d737b43e` | KEEP |
| `1cb96d5151c3b3c3dc96fc1c96e0fa35e04ed53f` | `693d9dd8ecdf33abfdcc635eb644af1e30f2ca59` | KEEP |
| `9354c8c808ceea6bf85d5c676575e9a02210d209` | `ffd9612d09c6190e4eab55cc17a22008d1d75320` | ADAPT |

Os patches foram reaplicados linearmente sobre a baseline oficial. O artefato gerado `AVIORA_MOBILE_GATE_0A.diff` foi removido do estado final; documentos históricos foram preservados com follow-ups, sem falsificação retroativa.

## 3. Princípios

1. Paridade é o mínimo; evolução premium é o objetivo.
2. A origem do dado pode mudar; a verdade financeira do AVIORA não.
3. Web, iOS e Android compartilham semântica financeira, Auth, entitlement e autorização.
4. Mobile não é WebView nem uma árvore reduzida da Web.
5. Componentes não classificam fatos financeiros nem decidem permissões.
6. Estado local não se torna verdade remota por conveniência.
7. Projetos futuros entram por extensão e gates próprios, nunca por código morto ou feature parcial.

## 4. Paridade funcional

O Mobile V1 final inclui todas as capacidades oficiais aplicáveis ao contexto autenticado:

- CUSTOMER acessa capacidades CUSTOMER;
- STAFF acessa capacidades autorizadas pelas suas permissões;
- OWNER acessa capacidades OWNER autorizadas;
- Administração não é automaticamente Web-only;
- writes disponíveis no produto oficial devem chegar ao Mobile após gates próprios;
- Reserva pertence à paridade, preservando inicialmente sua autoridade atual e uma fronteira substituível;
- trial/entitlement possuem uma semântica única entre plataformas, salvo obrigação externa formalmente aprovada.

`Read-only` é um estado seguro de implantação intermediária, não a definição do Mobile V1 final.

## 5. Arquitetura

```text
Routes / Screens
        ↓
Presentation + View Models
        ↓
Application Use Cases / Query Coordinators
        ↓
Domain Contracts
        ↓
Repository and Service Ports
        ↓
Infrastructure Adapters
        ↓
AVIORA Canonical Backend / Device Services
```

Dependências apontam para dentro. Screens não acessam Supabase, secure storage ou regras financeiras diretamente. Módulos coordenam-se por use cases e contratos, não por imports circulares.

## 6. Módulos atuais

Módulos oficiais a preservar na paridade:

- Auth e Conta;
- Dashboard;
- Lançamentos;
- Planejamento;
- Categorias;
- Metas;
- Cartões e faturas;
- Recorrências/compromissos;
- Contas;
- Reserva;
- Saúde Financeira atual;
- Investimentos/ativos;
- Patrimônio;
- Relatórios;
- Conhecimento/Biblioteca;
- Reader;
- Commercial/entitlements;
- Administração para STAFF/OWNER conforme permissionamento.

### 6.1 Matriz de paridade canônica

| Superfície | Web oficial | Mobile candidato | Requisito V1 | Read / Write | Acesso | Backend / estado local | Adaptação nativa / dependência futura |
|---|---|---|---|---|---|---|---|
| Auth/Cadastro/Conta | completo | parcial | completo | autenticar, recuperar, atualizar e encerrar sessão | público/autenticado | Supabase Auth; sessão segura local | PKCE, deep links, lifecycle e secure storage |
| Dashboard | completo | leitura parcial | completo | read | APP | read models financeiros | resumo responsivo e navegação nativa |
| Lançamentos | CRUD completo | leitura parcial | completo | read/write | APP + ownership | `transactions`, operações estruturadas | formulários nativos; write gate |
| Planejamento | completo | leitura parcial | completo | read/write | APP + ownership | `monthly_plans`, categorias e motores canônicos | composição mês/categoria; parity gate |
| Categorias | completo | ausente | completo | read/write | APP + ownership | categorias e cores do usuário | picker/gestão nativos |
| Metas | completo | resumo parcial | completo | read/write | APP + ownership | `goals` e projeção canônica | progresso e drill-down acessíveis |
| Cartões/Faturas | completo | cartão básico | completo | read/write | APP + ownership | ciclos, compras, parcelas, pagamentos, créditos e reversões | write/concurrency gate próprio |
| Recorrências | completo | ausente | completo | read/write/materializar | APP + ownership | `recurring` e RPC estruturada | lifecycle idempotente; write gate |
| Contas | completo | leitura parcial | completo | read/write | APP + ownership | `accounts` e snapshots | forms e saldo com `asOf` |
| Reserva | local no dispositivo Web | ausente | completo conforme contrato atual | read/write local inicialmente | APP + owner | repository local substituível | futuro adapter cross-device sem reescrever UI |
| Saúde Financeira | fórmula atual completa | ausente | paridade da versão oficial | read | APP | motor canônico atual | explicabilidade e acessibilidade; Saúde V2 fora |
| Investimentos/Ativos | funcional via patrimônio/relatórios | ausente | completo | read/write | APP + ownership | `assets` e transações | composição e origem; evolução posterior aditiva |
| Patrimônio | completo | incompleto | completo | read/write dos recursos oficiais | APP + ownership | contas + ativos − passivos + cartões + Reserva | resumo→composição→origem |
| Relatórios | completo | ausente | completo | read/export conforme oficial | APP | read models/agregações canônicos | gráficos acessíveis e share/print em gate próprio |
| Conhecimento/Biblioteca | completo | ausente | completo | read; progresso/favorito write | KNOWLEDGE/COMPLETE | catálogo, conteúdo, progress e bookmarks | cache entitlement-aware |
| Reader | completo | ausente | completo | read e estados oficiais | KNOWLEDGE/COMPLETE | conteúdo remoto; preferências/notas conforme autoridade atual | reader nativo; Premium/cross-device futuros |
| Commercial/Entitlements | completo | gate APP parcial | semântica comum | read; trial conforme contrato comum | produto/acesso | RPCs Commercial server-authoritative | políticas de loja em gate próprio |
| Administração | completo | ausente | completo quando autorizado | read/write administrativo | STAFF/OWNER + permission | Edge/RPCs administrativas e auditoria | navegação por capability; invisível ao CUSTOMER |

Nenhuma linha pode ser removida por conveniência de implementação. Uma diferença de plataforma altera apenas a interação, não o resultado funcional autorizado.

## 7. Módulos futuros

Open Finance, importação, IA, Sharing, reconciliação genérica, cross-device adicional, Saúde V2, Reader Premium e inteligência avançada não são módulos obrigatórios da V1 atual. Eles podem existir apenas como requisitos de extensibilidade.

## 8. Contracts

Contratos são TypeScript puro, independentes de React Native, Supabase e DOM. Devem cobrir progressivamente:

- Money em unidade e arredondamento canônicos;
- competência e timezone financeiro;
- status e efeitos econômicos;
- Realizado, Programado, Projetado e Previsão;
- IDs de operação, série, parcela e reversão;
- warnings tipados;
- ownership e AccessContext;
- DTOs de API versionados;
- envelopes conceituais de Evidence, Provenance e Reconciliation.

O kernel financeiro será migrado incrementalmente: contratos → ports → adapters → testes diferenciais/golden → um domínio por vez → equivalência → compartilhamento controlado. Este gate não inicia extração ampla para `packages/`.

## 9. Ports

Ports obrigatórios quando houver consumidor real:

- `AuthSessionPort`;
- `EntitlementRepository`;
- `PermissionRepository`;
- repositories por domínio financeiro;
- `ReserveRepository` substituível;
- `PrivateCachePort`;
- `SecureSessionStoragePort`;
- `EnvironmentPort`;
- `LifecyclePort`;
- `AuthDeepLinkPort`;
- `ObservabilityPort`;
- future `EvidencePort`, `ReconciliationPort`, `ImportPort` e `SharingPort`.

Uma interface futura não deve ser criada sem consumidor, mas as fronteiras não podem impedir sua adição.

## 10. Adapters

Adapters implementam ports e podem variar por plataforma:

- Supabase Auth/repositories/RPCs;
- secure storage com Keychain/Keystore;
- cache privado cifrado/reconstruível;
- Expo Linking/AppState;
- conectividade e filesystem quando autorizados;
- observabilidade com redaction.

Nenhum adapter recebe `service_role` ou segredo de servidor.

## 11. Data flow

```text
Source
  → Ingestion
  → Normalization
  → Matching
  → Reconciliation
  → Canonical Financial Event
  → Canonical Read Models
  → Web / iOS / Android
```

Dashboard, Metas, Planejamento, Cartões, Patrimônio e Relatórios consomem fatos/read models canônicos e não precisam conhecer se a origem foi manual, PDF, OFX, Open Finance ou API.

## 12. Auth

Foundation V1 exige:

- PKCE e redirects/deep links homologados;
- restauração e refresh de sessão conforme lifecycle;
- sessão protegida em storage adequado;
- falha fechada em configuração, expiração ou descriptografia;
- logout local/remoto conforme contrato do produto;
- proteção contra resposta assíncrona de identidade anterior;
- testes com app aberto, fechado, link expirado e troca A→B.

## 13. AccessContext

O contexto mínimo é:

```ts
type AccessContext = {
  actingUserId: string;
  subjectUserId: string;
  resourceOwnerId: string;
  role: 'CUSTOMER' | 'STAFF' | 'OWNER' | null;
  entitlements: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  capabilities: ReadonlyMap<string, CapabilityState>;
  environment: 'development' | 'beta' | 'production';
};
```

O formato é conceitual; implementação e campos finais dependem de gate. `auth.uid()` continua sendo a identidade autenticada no servidor.

## 14. Ownership

`OWNER OF DATA` não é sinônimo de `USER WITH ACCESS`.

- `actingUserId`: quem executa;
- `subjectUserId`: identidade cujo contexto está sendo operado;
- `resourceOwnerId`: proprietário canônico do recurso.

A UI nunca fabrica acesso por igualdade local. RLS/RPC validam ownership e autorização. A separação permite Sharing futuro sem implementá-lo agora.

## 15. Entitlements

Entitlement responde a qual produto/experiência comercial está disponível. APP, KNOWLEDGE e COMPLETE permanecem canônicos. Estado administrativo interno não equivale a licença comercial.

A semântica de trial deve ser comum entre Web, iOS e Android. Flags temporárias podem bloquear uma mutação durante desenvolvimento, mas não redefinem o contrato de produto.

## 16. Permissions

Permissions autorizam ações dentro de um papel e recurso. STAFF e OWNER devem receber apenas superfícies/ações permitidas. CUSTOMER nunca recebe informações administrativas internas. Checagem visual é UX; autorização real permanece server-side.

## 17. Capabilities

Capability é distinta de entitlement e permission:

```text
exists
enabled
entitled
permitted
platformSupported
minimumAppVersion
readWriteMode
```

Futuras capabilities nascem `unavailable`. Uma flag não concede entitlement ou permissão. Capacidades indisponíveis não aparecem parcialmente na navegação.

## 18. Persistence

| Classe | Exemplos | Autoridade |
|---|---|---|
| Canônico remoto | fatos financeiros, entitlements, grants, progresso remoto | backend |
| Sincronizável | futuras notas, preferências e Reserva cross-device | backend versionado quando aprovado |
| Local por dispositivo | tema, preferências de UI, biometria habilitada | dispositivo |
| Cache reconstruível | read models e conteúdo autorizado | derivado |
| Secreto | sessão, refresh token, chaves de cifra | secure storage |
| Temporário | filtros, navegação, drafts sem efeito financeiro | memória |

## 19. Cache

Cache privado deve ser particionado por:

```text
environment + userId + schemaVersion + queryKey + entitlementVersion
```

Troca A→B e logout invalidam memória e cache privado antes de renderizar a nova identidade. Cache incompatível é descartado. Revoke de KNOWLEDGE bloqueia imediatamente conteúdo protegido, inclusive offline.

## 20. Cross-device boundaries

UI e application layer dependem de repositories, não de `localStorage`/SQLite concreto. Reserva, notas, grifos, posições e preferências podem trocar um adapter local por um sincronizado futuramente sem reescrever screens ou semântica.

Não migrar dados locais silenciosamente nem representar sincronização inexistente.

## 21. Native services

Foundation V1 inclui as fronteiras concretamente necessárias para:

- secure storage;
- lifecycle foreground/background;
- Auth deep links;
- safe areas e teclado;
- ambientes development/beta/production;
- cache privado;
- compatibilidade básica iOS/Android.

Biometria, haptics, notificações avançadas, câmera, arquivos, share sheet e proteção adicional de tela entram apenas quando um gate/consumidor real exigir.

## 22. Navigation

Estrutura recomendada:

```text
Bootstrap
├─ Public/Auth Stack
├─ Access Gate
└─ App Shell
   ├─ Início
   ├─ Lançamentos
   ├─ Planejamento
   ├─ Patrimônio
   └─ Mais
```

Cinco tabs são organização, não redução de módulos. `Mais` expõe todas as capacidades aplicáveis, inclusive Administração para STAFF/OWNER autorizados. Módulos possuem stacks próprias, deep links allowlisted e retorno previsível.

## 23. API compatibility

- DTOs e comandos versionados;
- mudanças aditivas por padrão;
- leitores tolerantes a campos novos;
- sem reutilizar campo com nova semântica;
- negotiation de capability/minimum app version;
- suporte controlado a versões instaladas N/N−1;
- migrações locais transacionais;
- cache reconstruível em incompatibilidade;
- RPCs mutáveis idempotentes e versionadas.

## 24. Observability

Permitido:

- app/build/API/schema version;
- ambiente, plataforma, rota e capability;
- duração, request/correlation ID e código de erro;
- conectividade e estado de cache.

Proibido:

- JWT, senha, e-mail e secrets;
- valores, descrições e payloads financeiros;
- conteúdo Knowledge;
- evidência bruta;
- IDs privados sem pseudonimização aprovada.

## 25. Security

- chave publicável somente;
- RLS/RPC como autorização real;
- filtro explícito por usuário como defesa em profundidade;
- secure storage e purge obrigatório;
- segregação de ambientes;
- cache entitlement-aware;
- nenhuma mutation offline financeira na V1 sem gate específico;
- nenhum log sensível;
- testes negativos anon, A/B, entitlement expirado e cross-user;
- threat model antes de distribuição externa.

## 26. Testing

Gates mínimos:

- validação estática e TypeScript strict;
- testes unitários de contratos/application;
- paridade diferencial Web ↔ Mobile;
- golden accounting;
- schema/API contract;
- RLS/permissions/ownership negativos;
- retry, idempotência e concorrência por família de write;
- troca A→B, logout e cache purge;
- deep link/Auth/lifecycle em aparelhos;
- iOS e Android, acessibilidade e performance;
- scanners de secrets e writes proibidos;
- zero SKIP em paridade financeira.

## 27. Future projects matrix

| Projeto | Foundation now | Extension point now | Implementar agora |
|---|---|---|---|
| Open Finance | consumers independentes de fonte | Source/Evidence/Reconciliation ports | não |
| PDF/imagem/CSV/OFX | contratos de origem/proveniência | Import pipeline | não |
| Reconciliation | IDs e autoridade conceituais | matching/reconciliation boundary | não |
| IA financeira | redaction e authority | AI adapter boundary | não |
| Sharing | AccessContext/ownership | Sharing port | não |
| Reserva cross-device | repository substituível | sync adapter futuro | não |
| Investimentos/Patrimônio evoluídos | contratos canônicos | módulos aditivos | não |
| Reader Premium | entitlement/cache seguros | reader services futuros | não |
| Auditoria/Inteligência | correlation/provenance | audit adapter futuro | não |

## 28. Do not build now

- conexão Open Finance;
- parser de IA;
- importador PDF, CSV ou OFX funcional;
- Sharing funcional;
- Saúde V2;
- write financeiro offline;
- engine de conflito futura;
- checkout de lojas;
- Reader avançado;
- notificações financeiras inteligentes;
- qualquer feature futura sem gate próprio.

## 29. Implementation sequence

### Mobile Foundation

1. contratos e AccessContext;
2. ports e adapters mínimos;
3. secure session/storage;
4. purge A→B/logout e cache particionado;
5. lifecycle, Auth deep links e ambientes;
6. observabilidade redigida;
7. API/schema compatibility;
8. CI e QA físico iOS/Android.

### Mobile V1 parity

1. Auth/Conta/entitlements;
2. Dashboard;
3. Lançamentos;
4. Planejamento/Categorias;
5. Metas;
6. Contas/Investimentos/Patrimônio/Reserva;
7. Cartões/Recorrências;
8. Saúde atual/Relatórios;
9. Conhecimento/Reader;
10. Administração autorizada;
11. writes por gates independentes.

### Native premium

Somente após paridade: biometria, haptics, notificações, share sheet e otimizações específicas.

### Future integrations

Somente após gates: importação, Open Finance, Sharing, cross-device adicional, IA e inteligência avançada.

## 30. Gates

- **Foundation Security:** secure storage, purge, cache e ambiente.
- **Auth Device:** deep links, lifecycle, recovery e revogação.
- **Financial Parity:** equivalência por domínio, sem mudança semântica.
- **Write Family:** ownership, permission, idempotência, retry e concorrência.
- **Reserve:** contrato da implementação atual e adapter substituível.
- **Knowledge:** entitlement, leak e cache protegido.
- **Administration:** RBAC STAFF/OWNER e ausência para CUSTOMER.
- **Commercial Store:** trial, compra e políticas externas.
- **Release:** CI, builds, aparelhos, observabilidade e rollback.

## Grupo A — Foundation now

Boundaries modulares, AccessContext, identidades de atuação/sujeito/proprietário, entitlement, permission, capability, environment, repository ports, secure storage, identity purge, cache partitioning, lifecycle, Auth deep links, observabilidade redigida, compatibilidade API/schema, consumers financeiros independentes de fonte, ownership/reconciliation-ready contracts e classificação cross-device.

## Grupo B — Extension point now

Somente contratos/pontos de extensão para Open Finance, Evidence, Reconciliation, importação, IA, Sharing, cross-device, evolução de investimentos/patrimônio, auditoria/inteligência e futuras capacidades nativas.

## Grupo C — Do not build now

Nenhum provider ou feature futura funcional será criado durante a fundação. A lista normativa está na seção 28.
