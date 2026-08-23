# Mentoria Black — Kiwify webhook dual-compatible

Status: the legacy-token reader fix is homologated only on Supabase Beta
`amzgqfvyjaiaoohnbcfl`. Production remains on `kiwify-webhook` v4 and was not
accessed or altered during this work. Repeating production Checkpoint 1 is blocked
by the new-user issue recorded below.

## Compatibility contract

| Concern | Legacy Kiwify | Commercial Access V2 |
|---|---|---|
| Feature detection | no Commercial marker and no V2 RPC | exact marker plus `get_kiwify_webhook_contract_v2()` |
| Grant identity | `UNIQUE(user_id,product_id)` | historical grants plus focused partial unique indexes |
| Grant write | legacy upsert preserved | server-only transactional RPC; no old conflict target |
| Event identity | `(provider,event_id)` | `(provider,environment,external_event_id)` |
| Payload | legacy raw JSON preserved | SHA-256 plus bounded technical references; raw payload is null |
| Product | historical `mentoria-black` APP | APP, KNOWLEDGE and COMPLETE components |
| Partial transition | not applicable | Commercial marker without writer RPC fails closed |

The product-name fallback is deliberately narrow: only exact normalized
`Mentoria Black` maps the historical product to APP. Configured Kiwify offer IDs take
precedence in V2. Unknown or ambiguous mappings do not infer an entitlement.

## Event semantics

- approval creates or reuses the eligible paid APP grant; KNOWLEDGE is lifetime;
- renewal updates only the APP subscription leg;
- COMPLETE creates independent APP and KNOWLEDGE grants atomically;
- normal cancellation keeps APP until the paid-through timestamp and never removes
  lifetime KNOWLEDGE;
- late APP enters the configured grace period (72 hours in V1); expiration blocks APP;
- full refund and chargeback revoke the grants linked to the acquisition;
- explicit partial refund becomes `administrative_review` and changes no grant;
- unknown/out-of-order links fail closed for reconciliation;
- retry of the same event returns duplicate and has zero additional effect.

## Security

The public webhook has `verify_jwt=false` because Kiwify is not a Supabase user. The
function authenticates the raw request using HMAC SHA-1 or the private Kiwify webhook
token, compares tokens in constant time, limits payloads to 256 KB and validates all
technical IDs, provider, environment, event type and timestamps. The token lives in
Supabase Vault and getter/setter/processor RPCs are executable only by `service_role`.
No secret is stored in the frontend or repository, and responses/logs contain no
email, external ID or raw payload.

User lookup uses the official paginated server-side Admin API. A missing optional
legacy `profiles` table is compatible; any other profile error fails the event.
Ordinary users cannot call the processor, rotate/read the token or grant themselves
access.

The entrypoint reader and the request authenticator share one explicit validator that
preserves v4's existing minimum of eight characters, so deploying the dual writer
cannot silently disable the current production webhook. A newly installed V2 setter
requires 32–255 characters. Production token rotation to that stronger range
is recommended as a separate, controlled Auth/Vault operation before or during the
future production gate. This homologation did not read or change the production
token; Beta used only ephemeral synthetic values that were removed immediately.

## Token-compatibility evidence

- faithful legacy-to-V2 clone: 109 pgTAP + 89 shell assertions, preserving the exact
  1 product / 1 grant / 2 Kiwify event history;
- actual-entrypoint Node test: legacy token (8 characters), strong V2 token, empty,
  below-legacy-minimum, whitespace-only, header mismatch and authorized flow;
- the V2 SQL setter rejects 31 characters and accepts 32 or more; its migration and
  SHA remain unchanged;
- Beta v14 accepted an ephemeral 15-character legacy-profile token and an ephemeral
  43-character token written through the V2 setter; wrong header returned 401;
- using an existing controlled Beta user, approval, duplicate retry, renewal,
  cancellation, full refund and chargeback all returned 200 under `commercial_v2`;
- remote evidence before cleanup: six unique events, one approved event under retry,
  two historical grants, zero active conflicts and zero raw V2 payloads;
- cleanup returned Beta to two Auth test users, zero Kiwify events, zero Kiwify grants
  and no configured webhook token;
- deploy rollback restored the previous dual bundle as Beta v12, with SHA-256
  `13cd08c6621b8893190fda2fccbefdb4958ef5be9eadbbf79b25802efdf4ff8e`, then restored
  the token-reader candidate as Beta v14, `ACTIVE`, with bundle SHA-256
  `5428337e6898090a8b8f435a7941513d93ece2f654415c919f3c17bd2012c415`.

Beta Advisor findings remained the previously accepted server-only RLS/function
notices plus the pre-existing leaked-password warning. No new client grant or RLS
finding was introduced by the Kiwify contract.

## Production blocker discovered during re-homologation

An additional approval probe for a purchaser without an existing Mentoria Black
account failed before grant creation. The Auth log identifies the exact cause:
the temporary password is built as two UUIDs plus a hyphen (73 bytes), while bcrypt
accepts at most 72 bytes. Existing-user approval and every token-compatibility gate
pass, but a new Kiwify purchaser would fail account creation.

This task deliberately did not change that writer behavior because its authorization
was limited to the token reader. Production Checkpoint 1 must not be repeated until a
separate, reviewed change generates a cryptographically strong temporary password of
at most 72 bytes, adds an actual-entrypoint new-user test, and is re-homologated on
Beta. No synthetic user, grant, event or token from the failed probe remains.

## Future controlled production order

1. fix and re-homologate the bounded new-user password generation on Beta;
2. repeat the production gate, backup, project-ref, source-hash and v4-hash checks;
3. deploy the dual-compatible writer while production still has the legacy schema;
4. send one controlled legacy event and prove idempotency;
5. apply `20260822212119_commercial_access_v1.sql` transactionally;
6. immediately apply `20260823104202_install_kiwify_webhook_v2_contract.sql`;
7. retry/validate Kiwify in V2 and prove 1/1/2 historical rows unchanged;
8. continue with Knowledge, Editorial, protected content and frontend gates.

Between steps 4 and 5, the writer intentionally returns a retryable failure rather
than using the removed legacy conflict target. Rollback before Commercial is the v4
bundle. After Commercial, keep the dual writer and use application-first rollback;
do not restore v4 because it is intentionally incompatible with V2 grant history.
