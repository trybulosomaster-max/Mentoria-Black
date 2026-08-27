# AVIORA — Agent Execution Map

## Projeto

AVIORA — Gestão Financeira.

## Fontes de verdade

- Código, commits e migrations: GitHub/repositório.
- Backend e dados: Supabase.
- Visual aprovado: Figma.
- Decisões e estado operacional: Notion AVIORA, quando disponível.

## Protocolo de execução

- Preferir comandos mestres grandes e coerentes.
- Avançar entre checkpoints quando testes e integridade passarem.
- Evitar repetir leituras ou testes completos sem necessidade.
- Usar testes direcionados durante a implementação.
- Reservar a suíte completa para gate final ou release, quando necessária.

## Condições de parada

Parar diante de conflito relevante, divergência de arquitetura, migration/RLS não prevista, escrita Supabase/produção fora do gate, mudança destrutiva, finding crítico/alto ou merge/push em `main` sem autorização.

## Modelos

- ALTO: frontend, Git, testes, visual e rotina.
- ULTRA: segurança crítica, backend, migration/RLS, Edge e produção.

## Regras permanentes

- Não alterar motores financeiros fora do escopo.
- Preservar Realizado / Programado / Projetado / Previsão.
- Manter em português a UI visível ao usuário; códigos backend podem permanecer canônicos.
- Dashboard é resumo/alerta; telas densas mostram resumo primeiro e detalhe sob demanda.
- Acesso administrativo interno não é licença comercial.
- CUSTOMER não recebe informação administrativa interna.

## Multiplatform UI

- Web agora; preservar portabilidade futura para iOS e Android.
- Não depender de interação exclusiva da Web como único caminho.
- Manter lógica financeira e de negócio separada da apresentação.
- Garantir toque de pelo menos 44 px e respeito à safe-area.
- Tratar performance como parte da qualidade da interface.
- Cores das categorias são dados do usuário e permanecem consistentes.

## Notion

Se disponível:

1. Ler primeiro “⚡ AVIORA — Contexto Operacional Atual”.
2. Consultar apenas decisões relevantes.
3. Usar “AVIORA — Skill de Execução Codex” para o método de execução.
4. Não carregar todo o histórico.

Sem Notion, seguir a cápsula de contexto fornecida no prompt.

## Finalização

Relatar alterações, testes, segurança, Git, remoto alterado ou não, blockers e a próxima fronteira de autorização.
