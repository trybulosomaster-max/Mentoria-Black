# AVIORA Mobile — Gate 0A Closeout

## Escopo
Fechamento técnico restrito: corridas de sessão/snapshot, decisão de storage, paridade Web↔Mobile, lockfile, TypeScript e Expo Doctor. Nenhuma tela nova.

## Correções aplicadas
1. `AuthProvider`: toda leitura assíncrona de entitlement passa a carregar geração + `user_id` esperado. Resultado de sessão anterior é descartado.
2. `useMobileSnapshot`: toda carga recebe geração + `user_id`; resposta atrasada de A não pode atualizar a UI depois da troca para B.
3. `mobile-read.repository`: `loadMobileSnapshot(userId)` exige identidade explicitamente e adiciona `.eq('user_id', userId)` às consultas, mantendo RLS como autorização real e criando defesa em profundidade/cache determinístico.

## Decisão de storage — FECHADA
### Fundação/Beta interno
Manter `expo-sqlite/localStorage` para a sessão enquanto o aplicativo estiver em homologação interna. Essa escolha é compatível com o quickstart atual Expo + Supabase e evita truncamento de payload.

### Distribuição externa/produção
A sessão **não será promovida para release público em texto claro no SQLite**. A arquitetura final será um `LargeSecureStore`:
- payload de sessão cifrado em storage persistente;
- chave de cifra aleatória por item/instalação protegida por `expo-secure-store`/Keychain/Keystore;
- nenhuma `service_role` ou segredo de servidor no dispositivo;
- limpeza da sessão/cifra no logout;
- falha fechada em erro de descriptografia;
- migração testada sem vazamento A→B;
- biometria é bloqueio local opcional e não substitui autorização do servidor.

Motivo: `SecureStore` sozinho pode rejeitar payloads grandes em algumas plataformas/versões; a própria referência do Supabase documenta o padrão de chave no SecureStore + conteúdo cifrado em storage maior.

**Gate:** implementar e testar o adaptador cifrado antes de qualquer distribuição externa. Não é requisito para o Figma.

## Validações
Os resultados executados nesta entrega estão no relatório final. O ambiente desta sessão não possui acesso de rede do container ao npm/GitHub, portanto lockfile/Expo Doctor só podem ser declarados verdes se efetivamente executados em ambiente com registry disponível. Não falsificar esse gate.

## Resultado
- races A→B: CORRIGIDAS NO SOURCE;
- storage: DECISÃO ARQUITETURAL FECHADA;
- telas novas: ZERO;
- writes financeiros: ZERO;
- Supabase/backend: ZERO ALTERAÇÕES;
- produção/main: ZERO ALTERAÇÕES.
