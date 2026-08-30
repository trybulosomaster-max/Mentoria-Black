# AVIORA Mobile — Auditoria Supabase read-only

**Data local:** 2026-08-29
**Escopo:** preparação móvel; nenhuma alteração executada
**Projetos identificados:** `Mentoria Black V82 Beta` e `Mentoria Black`

## 1. Estado geral

Os dois projetos estavam ativos e saudáveis na consulta. O projeto de produção contém o domínio funcional necessário para a migração móvel: perfis, transações, contas, cartões, categorias, planejamento, metas, recorrências, patrimônio, comercial, conhecimento e faturamento estruturado de cartões.

## 2. RLS

Todas as tabelas do schema `public` listadas na auditoria estavam com RLS habilitado.

Isso é um sinal necessário, mas não suficiente. RLS habilitado sem política, política ampla ou função privilegiada pode continuar inadequada. Por isso a liberação móvel depende de testes de isolamento com usuários distintos.

## 3. Funções e Edge Functions

Foram identificadas:

- Edge Function de webhook Kiwify sem JWT, coerente com endpoint de webhook que precisa de autenticação própria;
- Edge Function administrativa com JWT habilitado;
- RPCs de entitlement, trial, conhecimento, operações estruturadas e cartões.

Nenhuma função foi invocada de forma mutável nesta auditoria.

## 4. Avisos do Security Advisor

O Advisor reportou:

- tabelas com RLS habilitado e sem políticas, incluindo tabelas privadas administrativas e algumas tabelas públicas de billing/admin;
- funções `SECURITY DEFINER` executáveis pelo papel `authenticated`.

As funções públicas inspecionadas incluem operações de cartão, trial e contexto administrativo.

## 5. Inspeção aprofundada

A leitura das definições mostrou, nas funções avaliadas:

- verificação de `auth.uid()`;
- verificação de acesso APP quando pertinente;
- `search_path` fixado em `pg_catalog`;
- delegação para rotinas em schema privado;
- rotinas privadas executáveis apenas por `postgres`;
- escopo por `user_id` em operações avaliadas;
- uso de `operation_id` e locks para idempotência em operações relevantes;
- validações de datas efetivas, snapshots e ownership em diferentes fluxos.

Isso reduz a probabilidade de um erro trivial de exposição, mas **não encerra a auditoria**. Função privilegiada precisa de teste negativo com IDs de outro usuário e revisão de cada caminho de dados.

## 6. Decisão móvel

### Liberado

- autenticação em ambiente Beta;
- `get_my_entitlements` em leitura;
- leitura de tabelas sob RLS;
- read models de Dashboard, Lançamentos, Planejamento e Patrimônio;
- geração de tipos TypeScript em modo leitura.

### Bloqueado até novo gate

- pagamento e reversão de fatura;
- criação e parcelamento de compra no cartão;
- crédito e reversão de compra;
- materialização de recorrência;
- qualquer mutation offline;
- mudança de schema/RLS;
- produção.

## 7. Matriz mínima de teste antes de write

Para cada RPC de escrita:

1. sucesso do proprietário;
2. ID inexistente;
3. ID pertencente ao usuário B;
4. sessão anônima;
5. usuário sem entitlement APP;
6. payload inválido;
7. repetição idempotente do mesmo `operation_id`;
8. mesmo `operation_id` com payload diferente;
9. data futura ou anterior ao snapshot quando proibida;
10. efeito econômico e patrimonial esperado;
11. ausência de vazamento no erro;
12. log/auditoria sem dado sensível.

## 8. Conclusão

`GO_READ_ONLY_BETA`
`NO_GO_FINANCIAL_WRITES` até o gate acima.
