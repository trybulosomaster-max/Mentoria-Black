# AVIORA — Agent Execution Map

## Projeto

AVIORA — Gestão Financeira.

## Fontes de verdade

- Notion: memória estratégica, decisões, histórico e contexto operacional.
- GitHub/repositório: verdade técnica de código, commits e migrations.
- AGENTS.md: mapa operacional persistente junto ao código.
- Figma: verdade visual aprovada.
- Supabase: verdade de backend e dados.

## Protocolo de execução

- Preferir comandos mestres grandes e coerentes.
- Avançar entre checkpoints quando testes e integridade passarem.
- Evitar repetir leituras ou testes completos sem necessidade.
- Antes de grandes implementações, definir aceite funcional/visual, testes, regressões, parada e evidências.
- Mapear o raio de impacto; usar testes direcionados durante a implementação e suíte ampla no gate apropriado.
- Cruzar análise técnica do Codex com revisão estratégica/sistêmica do ChatGPT antes do próximo gate relevante.

## Disciplina contínua

- Em execuções longas, adiantar apenas trabalho independente e de baixo risco; nunca presumir resultado pendente.
- Usar checkpoints leves após entregas relevantes e auditorias sistêmicas nos marcos do projeto.
- Registrar e priorizar dívida fora do escopo sem ampliar silenciosamente a entrega atual.
- Aplicar análise profunda a financeiro, segurança, Auth, backend, migration/RLS, arquitetura, produção e ações destrutivas; ser econômico em tarefas mecânicas.

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
