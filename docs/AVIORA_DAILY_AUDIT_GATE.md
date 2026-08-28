# AVIORA — Gate de Auditoria Operacional Diária

## Objetivo

Antes de integrações relevantes, executar uma auditoria estritamente **read-only** para comparar a verdade técnica do repositório com o estado público observável. A auditoria detecta divergências; ela não autoriza correções, deploy, autenticação, escrita remota ou alteração de dados.

## Escopo mínimo

Quando acessíveis, verificar:

- produção pública por GET/HTTP, redirects, HTML inicial e navegação pública;
- identidade AVIORA, assets referenciados, manifest, favicon e ícones;
- `main`, branches ativas relevantes, merge-base, ahead/behind e commits exclusivos;
- GitHub Pages, Actions, checks/status e SHA publicado;
- sinais automatizados atuais: testes, regressões recentes, console/page errors e segurança;
- divergências entre branch de trabalho, repositório remoto e estado operacional público.

## Classificação obrigatória

- **VERDE**: evidência atual coerente, sem regressão ou divergência relevante.
- **AMARELO**: limitação de verificação ou risco operacional conhecido que não invalida a evidência disponível.
- **VERMELHO**: regressão, divergência material, falha de segurança ou estado incompatível com integração.

O relatório deve registrar: classificação, achados, risco, ação recomendada e limitações. Ausência de acesso deve aparecer como `NOT_VERIFIED_IN_THIS_RUN`, nunca como aprovação presumida.

## Limites de evidência

Não inferir nem fabricar:

- login autenticado, sessão, permissões ou dados privados;
- comportamento interno a partir da página pública;
- preview local/LAN ou dispositivo físico a partir de emulação;
- aprovação de iPhone, notch, safe-area, teclado ou toque sem teste físico controlado.

Nenhuma credencial real, service role ou dado pessoal deve ser usado. A auditoria não altera produção, Pages, GitHub, Supabase, banco, Auth, Edge, Kiwify ou `main`.

## Hard stops

Interromper a preparação da integração diante de SHA desconhecido, perda de commits, worktree inexplicavelmente sujo, conflito, secret, regressão financeira/Auth/permissão, mudança backend inesperada, check obrigatório vermelho ou produção pública incompatível.

## Snapshot de consolidação — 2026-08-28

Status geral: **AMARELO**.

| Área | Estado | Evidência desta execução |
|---|---|---|
| Produção pública | VERDE | GET 200 sem redirect; título e identidade AVIORA presentes; assets locais, manifest e ícones referenciados responderam sem 404; smoke anônimo sem console/page error. |
| GitHub Pages | VERDE | Último build concluído no SHA de `origin/main` `efa1f78330859eb6c0be9b04ac2ea748add3e221`. |
| Branch visual | VERDE local | 44 arquivos unitários/contratuais verdes; Playwright 153 pass, 6 skips condicionais e 0 fail em Chromium, WebKit e Firefox. |
| CI remoto da branch | AMARELO | `REMOTE_BRANCH_CI_ABSENT`: nenhum run, check-run ou status remoto encontrado para o HEAD visual. |
| Proteção de `main` | AMARELO | GitHub informou branch sem proteção configurada; integração futura exige disciplina manual e autorização humana. |
| Aplicação autenticada | NOT_VERIFIED_IN_THIS_RUN | Este gate não usou credenciais nem sessão real. |
| iPhone físico | `PHYSICAL_IPHONE_FINAL_CONFIRMATION_PENDING` | Emulação não substitui dispositivo físico. |
| Preview LAN | `LOCAL_LAN_PREVIEW_NOT_VERIFIED` | A suíte usou harness local isolado em loopback, não acesso LAN de dispositivo. |

Risco recomendado: a evidência técnica permite preparar a integração, mas a execução deve preservar autorização humana explícita, repetir os checks no estado integrado e manter as limitações acima visíveis.
