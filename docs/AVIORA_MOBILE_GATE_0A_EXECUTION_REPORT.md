# AVIORA Mobile — Gate 0A — Relatório objetivo

## Resultado
**PARTIAL_GREEN — SOURCE_FIXES_COMPLETE / ENVIRONMENT_GATES_PENDING**

> **Follow-up — 2026-08-30:** este foi o resultado verdadeiro daquela execução.
> Em execução posterior no repositório real, os cinco gates ambientais foram
> concluídos: instalação/lockfile, paridade Web↔Mobile sem SKIP, check integral,
> `expo install --check` e Expo Doctor. O fechamento posterior está associado à
> fundação em `723a39ac715aa503e73a217a2b3821dd109c2fcf`; o estado histórico
> `PARTIAL_GREEN` acima é preservado deliberadamente.

## Mudanças
- `apps/mobile/scripts/validate-deliverable.mjs`
- `apps/mobile/src/core/auth/AuthProvider.tsx`
- `apps/mobile/src/features/read-models/mobile-read.repository.ts`
- `apps/mobile/src/features/read-models/use-mobile-snapshot.ts`
- `docs/AVIORA_MOBILE_GATE_0A_CLOSEOUT.md`

## O que foi concluído
- race de entitlement A→B corrigida com `entitlementGeneration`, `activeUserId` e descarte de resposta obsoleta;
- race de snapshot A→B corrigida com `requestGeneration`, `activeUserId` e descarte de resposta obsoleta;
- repository passou a exigir `userId` e aplica filtro explícito `user_id` além de RLS;
- decisão de storage fechada: SQLite/localStorage somente para homologação interna; release externo exige LargeSecureStore cifrado com chave protegida por Keychain/Keystore/SecureStore;
- validator ampliado com 3 gates de isolamento;
- 33/33 verificações estáticas aprovadas;
- 6/6 testes de contrato aprovados;
- typecheck dos contratos puros aprovado;
- nenhuma tela nova;
- nenhum write financeiro;
- nenhuma alteração em Supabase/backend/produção/main.

## Gates que NÃO puderam ser declarados verdes neste ambiente
1. `npm install --package-lock-only` — registry/npm indisponível no container; tentativa expirou por timeout.
2. typecheck integral — não é válido sem dependências instaladas (`expo/tsconfig.base`, React Native, Expo Router etc. ausentes).
3. `expo-doctor` — depende das dependências/registry.
4. paridade Web↔Mobile executável sem SKIP — o container não tem checkout do repositório real e não possui acesso de rede ao GitHub. Os três blobs congelados foram confirmados na `main` via integração GitHub, mas isso não substitui a execução do teste dentro do checkout integrado.

## Gate final
Não declarar `READY_FOR_MOBILE_FEATURE_WAVE_1` ainda.
O source das correções P0 está pronto; falta executar, em ambiente Codex/repo real com npm disponível:
```bash
cd apps/mobile
npm install
npm run test:parity
npm run check
npx expo install --check
npx expo-doctor@latest
```
Aceite: zero SKIP, zero divergência de hash/resultado, typecheck integral verde e Expo Doctor verde.
