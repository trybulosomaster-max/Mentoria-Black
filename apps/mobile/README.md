# AVIORA Mobile

Fundação React Native + Expo para iOS e Android.

## Estado

- autenticação e entitlement preparados para ambiente Beta;
- dados financeiros temporariamente em modo leitura durante a fundação;
- Mobile V1 final exige paridade de leitura e escrita com o produto oficial;
- trial temporariamente bloqueado por flag de desenvolvimento, sem criar
  semântica diferente da Web;
- secure storage, purge A→B/logout e cache privado pertencem ao Foundation V1
  e precisam ser fechados antes de distribuição externa;
- sem secrets;
- sem migration/RLS;
- sem publicação.

## Configuração

```bash
cp .env.example .env.local
npm install
npm run check
npx expo-doctor@latest
```

Preencha `.env.local` somente com URL e chave **publicável** do Supabase Beta. Nunca use `service_role`, secret key ou projeto de produção durante desenvolvimento.

## Execução

```bash
npm run ios
npm run android
```

A primeira execução nativa pode gerar os diretórios `ios/` e `android/`; eles permanecem ignorados até a equipe decidir se adotará workflow prebuild versionado.

## Gates

Consulte os documentos `docs/AVIORA_MOBILE_*` na raiz do repositório depois que o overlay for aplicado.

O contrato arquitetural corrente é
`docs/AVIORA_MOBILE_FOUNDATION_BLUEPRINT_V1.md`. Os blueprints/specs anteriores
permanecem como registros históricos.


## Gates antes de distribuição externa

- substituir os assets provisórios pela matriz oficial aprovada da AVIORA;
- publicar e vincular Termos de Uso e Política de Privacidade versionados;
- executar `npm run test:parity` dentro do repositório integrado, sem `SKIP`;
- revisar a proteção da sessão com threat model e decisão de storage;
- concluir build e QA em aparelhos iOS/Android reais.
