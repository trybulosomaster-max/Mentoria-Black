# AVIORA Mobile V1 — Blueprint funcional e técnico

**Status:** pronto para fundação móvel
**Baseline:** `main@9b8659643d5d66713d0f12e2af9422c573a27a8d`
**Plataformas:** iOS e Android
**Idioma visível:** português do Brasil
**Fuso financeiro de referência:** `America/Sao_Paulo`

---

## 1. Visão executiva

A AVIORA terá um aplicativo móvel compartilhado entre iOS e Android, construído em React Native com Expo estável e TypeScript estrito. Não será um WebView, um espelho da PWA nem um segundo produto financeiro desconectado.

A arquitetura móvel reutiliza quatro ativos já consolidados:

1. o Supabase como fonte de verdade;
2. os contratos financeiros já validados na Web;
3. os contratos comerciais e de acesso;
4. a identidade premium preta/dourada da AVIORA.

A interface, a navegação, o ciclo de sessão, o cache e as interações são próprios de mobile. A Web continua operando e não é substituída.

## 2. Objetivos de produto

O aplicativo deve permitir que o cliente:

- consulte sua situação financeira com rapidez;
- acompanhe lançamentos, planejamento e patrimônio;
- entre, recupere a conta e mantenha a sessão com segurança;
- use a mesma conta e os mesmos dados da Web;
- compreenda claramente o que está realizado, programado, projetado e previsto;
- evolua para metas, saúde, relatórios e conhecimento sem perder consistência;
- futuramente compartilhe recursos sem duplicar ou misturar valores.

## 3. Princípios inegociáveis

### 3.1 Uma fonte de verdade

O Supabase existente permanece a fonte de verdade. O aplicativo não cria banco paralelo, não duplica lançamentos e não infere dados financeiros a partir da interface.

### 3.2 Integridade antes de conveniência

Nenhuma fila offline, atualização otimista ou automação poderá alterar saldo, fatura, meta ou patrimônio sem um contrato explícito de idempotência, reconciliação e conflito.

### 3.3 Paridade por testes

Regras financeiras não serão reescritas durante a migração. Primeiro são congeladas fixtures e saídas da Web; depois o código puro é extraído; por fim Web e mobile passam a consumir o mesmo pacote.

### 3.4 Segurança no servidor

O cliente contém somente URL e chave publicável do Supabase. `service_role`, secrets e autorização baseada apenas na interface são proibidos. RLS/RPC continuam responsáveis pela autorização real.

### 3.5 Mobile de verdade

Safe areas, teclado, retorno do Android, gesto de voltar do iOS, acessibilidade, leitor de tela, escala de texto e alvos de toque de pelo menos 44 pontos fazem parte da definição de pronto.

## 4. Stack congelada

- Expo SDK 57 estável;
- React Native 0.86 fornecido pelo SDK;
- React 19.2;
- TypeScript estrito;
- Expo Router com rotas tipadas;
- Supabase JS com persistência compatível com React Native;
- EAS Build para development, preview e production;
- um único código CUSTOMER para iOS e Android;
- painel administrativo mantido exclusivamente na Web nesta versão.

Canary e React Native 0.87 ficam fora da fundação. Qualquer atualização de stack exige novo gate de compatibilidade.

## 5. Arquitetura de informação

### 5.1 Barra inferior

1. **Início** — panorama, alertas e principais movimentos;
2. **Lançamentos** — histórico, filtros, busca e ações financeiras futuras;
3. **Planejamento** — mês, orçamento e recorrências;
4. **Patrimônio** — contas, cartões, reserva, ativos e passivos;
5. **Mais** — Metas, Saúde, Relatórios, Conhecimento e Conta.

### 5.2 Navegação secundária

- stacks para detalhe e edição;
- modais ou bottom sheets para ações curtas;
- deep links para confirmação, recuperação de senha e conteúdo;
- layout lista/detalhe em tablets;
- rotas públicas, autenticadas e protegidas por entitlement separadas.

### 5.3 Hierarquia de conteúdo

O Dashboard mostra síntese e alerta. A tela especializada mostra explicação, composição e ação. Nenhum painel denso é comprimido para caber num telefone.

## 6. Ondas funcionais

### Onda 0 — Fundação executável

- splash e bootstrap;
- login;
- cadastro;
- confirmação e recuperação por deep link;
- persistência e renovação de sessão;
- gate de acesso/licença;
- shell autenticado;
- design tokens e componentes-base;
- navegação principal;
- carregamento, vazio, erro, offline e sessão expirada;
- observabilidade sem dados sensíveis;
- ambiente local/preview sem secrets.

### Onda 1 — Núcleo financeiro

- Dashboard;
- Lançamentos em leitura e, após gate, criação controlada;
- Contas;
- Cartões e faturas em leitura primeiro;
- Categorias e cores persistidas;
- paridade de cálculos com fixtures canônicas.

### Onda 2 — Organização e decisão

- Planejamento mensal;
- recorrências;
- Metas;
- Reserva e patrimônio;
- Saúde financeira;
- Relatórios.

### Onda 3 — Conhecimento e retenção

- biblioteca de conhecimento;
- leitura, progresso e favoritos;
- deep links internos;
- notificações sem valores sensíveis por padrão;
- biometria como bloqueio local opcional, nunca como substituta da autenticação do servidor.

### Onda 4 — Colaboração

Somente após novo gate de backend/RLS:

- nenhum acesso por padrão;
- concessão explícita por pessoa e recurso;
- contextos separados **Meu**, **Compartilhado** e **Conjunto**;
- mesma entidade financeira, sem cópias divergentes;
- trilha de concessão e revogação;
- identificação clara de origem e responsabilidade.

## 7. Arquitetura de software

```text
apps/mobile/
  app/                       # rotas Expo Router
  src/
    core/                    # ambiente, Supabase, sessão
    design-system/           # tokens e componentes
    domain/                  # contratos puros
    features/                # casos de uso e telas
    lib/                     # formatadores e utilitários
  tests/
packages/                    # futura extração compartilhada
  aviora-contracts/
  aviora-domain-finance/
  aviora-domain-access/
  aviora-design-tokens/
```

### 7.1 Limites

- Tela não consulta tabela diretamente.
- Repositório não contém regra de apresentação.
- DTO do Supabase é convertido para read model.
- Regra financeira não depende de React Native, DOM ou biblioteca de gráfico.
- Ações sensíveis passam por RPC especializada quando esse é o contrato do backend.
- Erros SQL não aparecem ao cliente.

### 7.2 Dinheiro e datas

- representação monetária segue o contrato canônico existente;
- arredondamentos não são inventados no cliente;
- datas financeiras usam data civil explícita;
- comparações críticas respeitam `America/Sao_Paulo`;
- `created_at` não substitui data financeira;
- status futuro não é silenciosamente tratado como realizado.

## 8. Autenticação e acesso

### 8.1 Sessão

- persistência por storage compatível com React Native;
- a fundação usa o adaptador `localStorage` do Expo SQLite para suportar o tamanho da sessão, dentro do sandbox do aplicativo; antes de distribuição pública, a estratégia deve passar por threat model e decisão explícita sobre proteção hardware-backed e migração de sessão;
- auto-refresh somente enquanto o app estiver ativo;
- limpeza de sessão, cache e estado no logout;
- nenhuma reutilização de cache após troca de usuário;
- deep links configurados em ambiente de homologação antes de produção.

### 8.2 Cadastro

A `main` auditada usa mínimo de **6 caracteres** e aceite de Termos/Privacidade. A fundação móvel replica essa regra para não divergir silenciosamente. Existe um gate separado para decidir endurecimento uniforme antes das lojas.

### 8.3 Entitlement

O app consulta `get_my_entitlements`. A inicialização de trial não acontece automaticamente: `start_my_app_trial` fica desabilitada por flag até revisão de UX, autorização e política comercial.

## 9. Dados e offline

### Fundação

- leitura online;
- cache controlado e segregado por usuário;
- refresh manual;
- estado offline explícito;
- nenhum write financeiro em fila;
- nenhum efeito otimista irreversível.

### Evolução permitida

- rascunhos locais sem efeito financeiro;
- cache de conteúdo público ou autorizado;
- sincronização de progresso com idempotência;
- mutações offline somente após projeto específico de reconciliação.

Pagamentos, estornos, créditos, fechamento de fatura e operações patrimoniais permanecem online até auditoria dedicada.

## 10. Design system

- fundo preto e painéis grafite;
- dourado apenas para identidade, foco e ação principal;
- contraste verificável;
- textos e estados não dependem somente de cor;
- espaçamento e raios definidos por tokens;
- componentes touch com mínimo de 44 pontos;
- suporte a safe areas e teclado;
- tipografia escalável;
- movimento reduzido respeitado;
- categorias usam a cor salva pelo usuário, com fallback acessível.

## 11. Segurança e privacidade

- somente chave publicável no bundle;
- nenhum valor financeiro, e-mail, token ou descrição de lançamento em logs;
- notificações privadas por padrão;
- RLS em toda superfície exposta;
- RPC `SECURITY DEFINER` submetida a teste entre usuários antes do consumo de escrita;
- dependências fixadas e lockfile commitado;
- cache sensível mínimo;
- bloqueio de deep link malformado e replay;
- painel ADMIN não incluído no app CUSTOMER.

## 12. Observabilidade

Eventos permitidos devem usar nomes sem payload financeiro, por exemplo:

- `session_bootstrap_succeeded`;
- `entitlement_load_failed`;
- `dashboard_read_failed`;
- `route_opened` com rota categórica;
- `app_version` e plataforma.

Nunca registrar saldo, valor, categoria, descrição, e-mail, JWT ou conteúdo privado.

## 13. Testes

### Unidade

- acesso comercial;
- política de cadastro;
- status financeiros;
- datas civis;
- formatação;
- adaptadores e erros.

### Paridade diferencial

- o port móvel compara seus resultados diretamente com `js/financial-core.js`, `commercial/access-contract.js` e `js/signup-password-policy.js`;
- os testes conferem também os Git blob hashes congelados da baseline;
- no overlay isolado eles são marcados como `SKIP` por ausência dos arquivos Web; depois da integração no repositório real, qualquer `SKIP`, hash divergente ou resultado diferente bloqueia o gate.

### Integração

- sessão persistida;
- logout e troca de conta;
- gate de entitlement;
- consultas sob RLS;
- falhas de rede;
- cache segregado.

### E2E

- iOS e Android;
- login, cadastro e recuperação;
- usuário A não lê usuário B;
- deep links;
- restauro após fechamento;
- leitor de tela e escala de fonte;
- aparelho real, simulador e emulador.

### Gate de cartões

Antes de qualquer escrita móvel:

1. revisar cada aviso do Security Advisor;
2. provar ownership no wrapper e nas rotinas privadas;
3. testar IDs pertencentes a outro usuário;
4. testar replay e `operation_id`;
5. validar datas efetivas e snapshots;
6. validar efeito patrimonial;
7. registrar evidências e parecer explícito.

## 14. Build e distribuição

Perfis EAS:

- `development`: development client;
- `preview`: distribuição interna e backend Beta;
- `production`: bloqueado até release gate.

Identificadores provisórios:

- iOS: `com.aviora.app`;
- Android: `com.aviora.app`.

Eles dependem de disponibilidade, contas de loja e decisão jurídica da marca.

## 15. Políticas de loja

Checkout, assinatura ou upgrade dentro do app não pertencem à V1. A primeira versão apenas consome o entitlement já concedido. Qualquer venda dentro do app exige revisão atualizada das regras da Apple e Google antes da implementação. Antes de qualquer distribuição externa, o cadastro deve abrir versões publicadas e auditáveis dos Termos de Uso e da Política de Privacidade, e as declarações de privacidade das lojas devem corresponder ao comportamento real do aplicativo.

## 16. Não objetivos

- substituir a Web;
- portar ADMIN para mobile;
- alterar Supabase;
- reescrever o motor financeiro;
- publicar em loja;
- ativar colaboração;
- ativar mutações sensíveis;
- usar WebView como produto principal;
- inserir checkout.

## 17. Critérios de aceite da fundação

- projeto abre em iOS e Android;
- TypeScript estrito sem erros;
- rotas públicas e protegidas funcionam;
- sessão persiste e renova;
- logout remove estado e cache;
- entitlement é respeitado;
- design system aplicado;
- safe area e teclado validados;
- nenhum secret no repositório;
- testes unitários e smoke aprovados;
- testes diferenciais contra os contratos Web executados sem `SKIP` e sem divergência;
- nenhum write financeiro;
- nenhuma alteração de banco, produção ou `main`;
- evidências anexadas ao PR.

## 18. Sequência de integração

1. aplicar scaffold numa branch de feature;
2. instalar dependências com lockfile;
3. executar validação estática e Expo Doctor;
4. configurar somente o projeto Beta;
5. testar autenticação em iOS/Android;
6. testar entitlement;
7. validar leitura financeira sob RLS;
8. executar os testes diferenciais com os arquivos Web presentes e conferir os hashes congelados;
9. comparar fixtures e read models com a Web;
10. abrir PR draft;
11. manter produção e lojas bloqueadas.

## 19. Gate de saída

A fundação recebe `READY_FOR_MOBILE_FEATURE_WAVE_1` somente quando todos os critérios de aceite tiverem evidência. Falha de isolamento, divergência financeira, secret, migration ou write em produção produz `BLOCKED` imediato.

## 20. Parecer do blueprint

**GO:** fundação, autenticação homologada, modo leitura e design system.
**NO-GO temporário:** escrita financeira sensível, colaboração, produção, checkout e lojas.
