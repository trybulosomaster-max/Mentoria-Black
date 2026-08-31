# AVIORA Mobile V1 — Comando mestre para Codex

> **Comando histórico executado.** A baseline, os bloqueios de trial/Admin e a
> estratégia de implementação deste comando não devem ser reutilizados como
> contrato corrente. A autoridade atual é
> `AVIORA_MOBILE_FOUNDATION_BLUEPRINT_V1.md`.

Copie o bloco abaixo para a execução responsável pela integração. O comando pressupõe acesso ao repositório, Node 22+, ambiente iOS/Android e permissão para criar uma branch, mas **não** autoriza merge, push em `main`, deploy ou alteração de Supabase.

---

## COMANDO

Você está no repositório `trybulosomaster-max/Mentoria-Black` e deve integrar a fundação móvel AVIORA para iOS e Android.

### Autoridade e limites

- Baseline auditada: `main@9b8659643d5d66713d0f12e2af9422c573a27a8d`.
- Se a `main` tiver avançado, faça primeiro uma auditoria de divergência e informe impacto. Não force a baseline.
- Crie a branch `feat/aviora-mobile-foundation-v1`.
- Não faça commit, merge ou push na `main`.
- Não altere Supabase, migrations, RLS, Edge Functions, secrets ou produção.
- Não publique em App Store, Play Store ou EAS production.
- Não implemente writes financeiros, checkout, colaboração ou painel admin.
- Pare imediatamente diante de secret, necessidade de migration/RLS, divergência financeira, falha de isolamento ou write em produção.

### Material de entrada

Existe um overlay contendo:

- `apps/mobile/`;
- `docs/AVIORA_MOBILE_BLUEPRINT_V1.md`;
- `docs/AVIORA_MOBILE_CRITICAL_REVIEW_V1.md`;
- `docs/AVIORA_MOBILE_SPEC_FREEZE_V1.md`;
- `docs/AVIORA_MOBILE_SUPABASE_READ_ONLY_AUDIT_2026-08-29.md`.

Aplique somente esses caminhos, preservando o restante do repositório.

### Etapa 1 — Pré-auditoria

1. Confirme branch, HEAD, working tree e remotes.
2. Leia `AGENTS.md`, a especificação congelada e o blueprint.
3. Verifique que nenhum caminho de destino já existe.
4. Rode a auditoria read-only obrigatória do projeto: produção pública quando acessível, `main`, Pages/CI, testes principais e divergências de navegação/auth/assets.
5. Declare limitações de fluxos autenticados, simuladores ou LAN.

**Modelo recomendado:** GPT-5.6 Codex/Thinking.
**Risco:** baixo, desde que read-only.
**Checkpoint:** relatório de baseline antes de alterar arquivos.

### Etapa 2 — Branch e instalação

1. Crie `feat/aviora-mobile-foundation-v1`.
2. Aplique o overlay.
3. Em `apps/mobile`, execute `npm install` para gerar lockfile.
4. Rode `npm run validate:source`, `npm run typecheck:contracts`, `npm run test:contracts`, `npm run test:parity`, `npm run typecheck` e `npx expo-doctor@latest`.
5. No repositório integrado, `npm run test:parity` deve executar sem `SKIP`; hash ou resultado divergente exige auditoria e novo freeze.
6. Corrija somente incompatibilidades da fundação. Não amplie escopo.

**Modelo recomendado:** GPT-5.6 Codex.
**Risco:** médio por dependências.
**Checkpoint:** source validation, contratos, TypeScript e Expo Doctor verdes.

### Etapa 3 — Configuração Beta

1. Use exclusivamente o projeto Supabase `Mentoria Black V82 Beta`.
2. Crie `.env.local` local, nunca commitado.
3. Configure somente URL e chave publicável.
4. Confirme que não existe `service_role`, `sb_secret_` ou chave privada no bundle.
5. Configure redirects/deep links Beta para `aviora://` e URLs de development build.
6. Não habilite trial automático; mantenha `EXPO_PUBLIC_AVIORA_ENABLE_TRIAL_START=false`.
7. Registre a persistência de sessão via Expo SQLite como escolha Beta e não a promova a decisão final de segurança sem threat model.

**Modelo recomendado:** GPT-5.6 Thinking.
**Risco:** alto se ambiente for confundido com produção.
**Checkpoint:** prova de projeto Beta e scanner de secrets aprovado.

### Etapa 4 — Execução nativa

1. Gere development build ou rode no ambiente compatível.
2. Valide iOS e Android.
3. Teste welcome, login, cadastro, recuperação, redefinição, sessão e logout.
4. Teste app fechado/aberto via deep link.
5. Verifique teclado, safe area, retorno Android, gesto iOS, escala de texto e leitor de tela.
6. Valide 375, 390 e 430 pontos e pelo menos um tablet.
7. Confirme que o aceite de Termos/Privacidade não será usado em distribuição externa sem links publicados e versionados.

**Modelo recomendado:** GPT-5.6 Codex com browser/device verification.
**Risco:** médio.
**Checkpoint:** screenshots, logs sanitizados e matriz de dispositivos.

### Etapa 5 — Acesso e leitura

1. Teste `get_my_entitlements` sem iniciar trial automaticamente.
2. Teste usuário com APP, KNOWLEDGE, COMPLETE, sem acesso e expirado.
3. Valide Início, Lançamentos, Planejamento e Patrimônio.
4. Execute primeiro os testes diferenciais contra os arquivos Web e seus hashes congelados; depois compare read models com fixtures/snapshots controlados.
5. Execute teste A→logout→B e confirme ausência de cache cruzado.
6. Execute testes negativos de leitura entre usuários.
7. Não invoque RPC de escrita financeira.

**Modelo recomendado:** GPT-5.6 Thinking.
**Risco:** alto por dados e isolamento.
**Checkpoint:** evidências de paridade e isolamento.

### Etapa 6 — QA e fechamento

1. Rode todos os testes da Web afetados e os testes móveis.
2. Refaça scanner de secrets e writes proibidos.
3. Confirme que Supabase, produção, Pages e `main` não mudaram.
4. Faça commits separados e legíveis:
   - `docs(mobile): freeze AVIORA mobile v1 specification`
   - `feat(mobile): add Expo iOS and Android foundation`
   - `test(mobile): add contracts and source safety gates`
5. Abra PR draft contra `main` com riscos, evidências e itens ainda bloqueados.
6. Não faça merge nem push em `main` sem autorização explícita.

**Modelo recomendado:** GPT-5.6 Thinking.
**Risco:** médio.
**Gate final:** `READY_FOR_MOBILE_FEATURE_WAVE_1` somente se F0–F4 estiverem completos.

### Critérios de falha obrigatória

Declare `BLOCKED` e pare se ocorrer qualquer um:

- ambiente apontando para produção durante homologação;
- secret no código ou build;
- necessidade de migration/RLS;
- leitura cruzada entre usuários;
- divergência financeira sem explicação;
- sessão/cache do usuário anterior;
- write financeiro não autorizado;
- falha crítica no iOS ou Android;
- teste diferencial marcado como `SKIP` após integração, hash inesperado ou resultado divergente;
- intenção de escrever na `main` diretamente.

### Saída esperada

Entregue:

- branch e commits;
- versões efetivamente instaladas;
- relatório de comandos e testes;
- matriz iOS/Android;
- evidências de auth, entitlement e isolamento;
- divergências da baseline;
- riscos restantes;
- parecer `READY_FOR_MOBILE_FEATURE_WAVE_1` ou `BLOCKED`.

---

## Observação

A política de senha móvel deve permanecer em paridade com a `main` atual — mínimo de 6 caracteres — até uma decisão explícita de hardening conjunto. Não endureça apenas o mobile.
