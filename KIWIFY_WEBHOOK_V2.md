# Mentoria Black — Kiwify webhook dual-compatible

Status: homologated only on Supabase Beta `amzgqfvyjaiaoohnbcfl`. Production remains
on `kiwify-webhook` v4 and was read-only throughout this work.

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

The reader preserves v4's existing minimum of eight characters so deploying the dual
writer cannot silently disable the current production webhook. A newly installed V2
setter requires 32–255 characters. Production token rotation to that stronger range
is recommended as a separate, controlled Auth/Vault operation before or during the
future production gate; this homologation did not read or change the token value.

## Evidence

- faithful legacy-to-V2 clone: 109 pgTAP + 88 shell assertions, preserving the exact
  1 product / 1 grant / 2 Kiwify event history;
- Node request/contract suite: authentication, HMAC, routing, size/shape validation,
  supported Admin API and non-leaking duplicate responses;
- Beta remote: missing token rejected; approval, replay, renewal, partial refund,
  late/grace, cancellation, expiration, full refund and chargeback passed;
- remote V2 result: 10 events, 3 historical grants, zero active conflicts, zero raw
  V2 payloads; all fixtures and the ephemeral test token were removed;
- deploy rollback: production v4 bundle SHA-256
  `4e05db916526212b9b22bf9b2d44794e86d3008f9d23fb54f8a336b3c083c301` was
  temporarily deployed only to Beta, then the dual writer was restored and hardened
  as Beta v7
  with bundle SHA-256
  `13cd08c6621b8893190fda2fccbefdb4958ef5be9eadbbf79b25802efdf4ff8e`.

Beta Advisor findings remained the previously accepted server-only RLS/function
notices plus the pre-existing leaked-password warning. No new client grant or RLS
finding was introduced by the Kiwify contract.

## Future controlled production order

1. confirm backup, production project ref, source hashes and current v4 hash;
2. deploy the dual-compatible writer while production still has the legacy schema;
3. send one controlled legacy event and prove idempotency;
4. apply `20260822212119_commercial_access_v1.sql` transactionally;
5. immediately apply `20260823104202_install_kiwify_webhook_v2_contract.sql`;
6. retry/validate Kiwify in V2 and prove 1/1/2 historical rows unchanged;
7. continue with Knowledge, Editorial, protected content and frontend gates.

Between steps 4 and 5, the writer intentionally returns a retryable failure rather
than using the removed legacy conflict target. Rollback before Commercial is the v4
bundle. After Commercial, keep the dual writer and use application-first rollback;
do not restore v4 because it is intentionally incompatible with V2 grant history.
