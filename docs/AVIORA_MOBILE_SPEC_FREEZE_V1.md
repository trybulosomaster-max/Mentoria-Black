# AVIORA Mobile V1 — Especificação congelada

> **Freeze superado — 2026-08-30.** Este documento registra a primeira decisão
> de scaffold e permanece histórico. Administração Web-only, trial divergente,
> paridade limitada e extração imediata não são mais decisões vigentes. O freeze
> arquitetural atual é `AVIORA_MOBILE_FOUNDATION_BLUEPRINT_V1.md`.

**Freeze ID:** `AVIORA-MOBILE-FOUNDATION-V1`
**Baseline:** `9b8659643d5d66713d0f12e2af9422c573a27a8d`
**Estado:** `FROZEN_FOR_IMPLEMENTATION`

## 1. Decisões congeladas

1. React Native com Expo SDK 57 estável.
2. React Native 0.86 e React 19.2 fornecidos pelo SDK.
3. TypeScript estrito.
4. Expo Router com rotas tipadas.
5. Um único aplicativo CUSTOMER para iOS e Android.
6. Tema escuro AVIORA preto/dourado.
7. Navegação: Início, Lançamentos, Planejamento, Patrimônio e Mais.
8. Supabase existente como fonte de verdade.
9. Chave publicável apenas; `service_role` proibida.
10. Admin permanece Web.
11. Modo leitura financeira na fundação.
12. Nenhuma fila offline de mutação financeira.
13. Nenhuma migration, RLS ou Edge Function nesta onda.
14. Nenhum checkout dentro do app.
15. Nenhuma colaboração nesta onda.
16. Paridade da política de cadastro com a `main` auditada: mínimo de 6 caracteres, até decisão conjunta de hardening.
17. Trial não inicia automaticamente.
18. Produção e lojas bloqueadas.
19. Identificadores `com.aviora.app` são provisórios.
20. A extração financeira ocorre por fixtures e adaptador, sem reescrita.
21. Os contratos Web ficam congelados pelos Git blob hashes documentados nos testes diferenciais.
22. Testes de paridade que apareçam como `SKIP` no repositório integrado não satisfazem o gate.
23. Termos de Uso e Política de Privacidade publicados são requisito de distribuição externa, não da execução local da fundação.

## 2. Escopo implementado no scaffold

- configuração Expo/EAS;
- design tokens e componentes-base;
- rotas públicas e protegidas;
- provider de autenticação;
- login, cadastro, recuperação e redefinição;
- entitlement em leitura;
- tela de acesso;
- tabs principais;
- read repository para Dashboard, Lançamentos, Planejamento e Patrimônio;
- modo read-only por padrão;
- testes de contratos puros;
- testes diferenciais com hash gate para execução após integração;
- scanner de secrets e writes proibidos.

## 3. Fora do scaffold

- criação/edição/exclusão financeira;
- pagamento e estorno de fatura;
- crédito de compra;
- materialização de recorrência;
- gráficos finais;
- cache persistente de read models;
- notificações;
- biometria;
- compartilhamento;
- admin;
- publicação.

## 4. Regras de mudança

Uma decisão congelada só pode mudar com um registro que contenha:

- motivo;
- alternativas avaliadas;
- impacto em Web, iOS, Android, backend e testes;
- plano de migração;
- riscos;
- aprovação explícita;
- atualização deste documento.

Mudanças de banco, RLS, função privilegiada, produção, secret ou `main` exigem parada e autorização específica.

## 5. Gates

### Gate F0 — Fonte

- [ ] pacote aplicado em branch isolada;
- [ ] sem conflito com baseline;
- [ ] sem secrets;
- [ ] lockfile gerado e commitado;
- [ ] Expo Doctor aprovado;
- [ ] `npm run test:parity` executado no repositório real, sem `SKIP` e sem divergência de hash/resultado.

### Gate F1 — Execução

- [ ] iOS inicia;
- [ ] Android inicia;
- [ ] navegação abre todas as tabs;
- [ ] safe areas corretas;
- [ ] sem erro de console crítico.

### Gate F2 — Auth Beta

- [ ] login;
- [ ] cadastro;
- [ ] confirmação;
- [ ] recuperação por app fechado e aberto;
- [ ] redefinição;
- [ ] sessão persistida;
- [ ] logout limpa estado.

### Gate F3 — Acesso e leitura

- [ ] entitlement correto;
- [ ] sem trial automático;
- [ ] Dashboard lê apenas dados do usuário;
- [ ] Lançamentos preservam status;
- [ ] Planejamento e patrimônio corretos;
- [ ] usuário A não lê B;
- [ ] troca A→B não reaproveita cache.

### Gate F4 — Qualidade

- [ ] TypeScript estrito;
- [ ] testes de contrato;
- [ ] acessibilidade;
- [ ] escala de fonte;
- [ ] aparelhos 375/390/430 e tablet;
- [ ] performance aceitável;
- [ ] evidências anexadas ao PR;
- [ ] estratégia de armazenamento de sessão registrada como risco Beta e gate pré-distribuição.

## 6. Estado final permitido

Ao concluir F0–F4, declarar:

`READY_FOR_MOBILE_FEATURE_WAVE_1`

Qualquer ausência de evidência mantém:

`FOUNDATION_NOT_RELEASEABLE`
