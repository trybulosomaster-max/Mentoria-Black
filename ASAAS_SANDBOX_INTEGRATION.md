# Mentoria Black — Asaas Sandbox integration runbook

Status: prepared and tested locally only. This document does not authorize a remote
migration, Edge Function deployment, webhook registration, checkout, charge, merge or
production use.

## Fixed provider contract

- environment: `sandbox`;
- base URL: `https://api-sandbox.asaas.com/v3`;
- authentication header: `access_token`;
- User-Agent: `Mentoria Black / Sandbox`;
- webhook authentication header: `asaas-access-token`;
- callbacks are navigation only; only an authenticated, idempotent payment webhook can
  activate a grant.

The client rejects every base URL except the fixed Sandbox URL, every environment other
than `sandbox`, and every key that does not have the documented Sandbox prefix. No code
sends an Asaas key as `Authorization: Bearer`.

## Server-only configuration

Required secrets/configuration for a future isolated test environment:

| Name | Purpose |
| --- | --- |
| `ASAAS_API_KEY` | Sandbox API key, Edge/server only |
| `ASAAS_WEBHOOK_TOKEN` | independent strong webhook token, never the API key |
| `ASAAS_ENV` | must equal `sandbox` |
| `ASAAS_BASE_URL` | must equal the fixed Sandbox URL |
| `ASAAS_CALLBACK_BASE_URL` | credential-free HTTPS base URL of the test frontend |

Offer values remain deliberately unconfigured. A future approved Sandbox window must
set synthetic test prices and explicit enable switches:

- `ASAAS_PRICE_APP_MONTHLY` / `ASAAS_ENABLE_APP_MONTHLY`;
- `ASAAS_PRICE_APP_ANNUAL` / `ASAAS_ENABLE_APP_ANNUAL`;
- `ASAAS_PRICE_KNOWLEDGE_LIFETIME` / `ASAAS_ENABLE_KNOWLEDGE_LIFETIME`;
- `ASAAS_PRICE_COMPLETE` / `ASAAS_ENABLE_COMPLETE`;
- `ASAAS_COMPLETE_CYCLE`, exactly `MONTHLY` or `YEARLY`.

No Asaas object ID or commercial price is hardcoded. Secrets must be inserted through
the Supabase Edge Function secret store or another approved server-side secret store.
They must never enter frontend code, Git, versioned `.env`, fixtures, screenshots or
logs.

For a temporary zsh session, collect secrets without terminal echo and erase them after
use:

```zsh
read -r -s "ASAAS_API_KEY?Asaas Sandbox API key: "; export ASAAS_API_KEY; printf '\n'
read -r -s "ASAAS_WEBHOOK_TOKEN?Independent webhook token: "; export ASAAS_WEBHOOK_TOKEN; printf '\n'
# Run only the separately approved Sandbox setup command here.
unset ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN ASAAS_SANDBOX_TEST_CPF_CNPJ
```

Do not reuse any credential that has previously appeared in a terminal transcript,
chat, file or log.

## Offers and checkout behavior

The server has four canonical intents:

| Intent | Asaas charge | Cycle | Independent entitlements |
| --- | --- | --- | --- |
| `APP_MONTHLY` | `RECURRENT` | `MONTHLY` | APP |
| `APP_ANNUAL` | `RECURRENT` | `YEARLY` | APP |
| `KNOWLEDGE_LIFETIME` | `DETACHED` | — | KNOWLEDGE lifetime |
| `COMPLETE` | `RECURRENT` | configured | APP + KNOWLEDGE lifetime |

Recurring checkout is restricted to card in this first contract. The detached
KNOWLEDGE checkout supports Pix and card. Checkout creation writes a pending internal
order with a random opaque `mbo_…` reference, calls Asaas, then stores only the Asaas
checkout ID. It never creates a grant.

The three callback URLs point to `commercial/checkout-callback.html` with a fixed state.
The success message is: “Pagamento recebido para processamento. Seu acesso será
liberado após confirmação.” None of the callbacks mutate commercial state.

## Customers and privacy

`billing_customers` relates the authenticated Supabase user to the provider customer ID
by `(user_id, provider, environment)`. Subsequent checkouts reuse that ID; email is not
a primary key. If no mapping exists, Checkout may collect payer data on Asaas. A valid
payment webhook links the returned technical customer ID to the internal user.

The direct customer adapter exists for controlled Sandbox tests. Asaas currently
requires CPF/CNPJ for direct customer creation; the value is transmitted to Asaas but
is not persisted by this application or logged. The homologation script requires a
temporary synthetic Sandbox-only value and disables customer notifications. Never use
real third-party contact data.

## Webhook and event processor

The checkout endpoint admits browser calls only from the exact HTTPS origin derived
from `ASAAS_CALLBACK_BASE_URL`; its preflight response never uses a wildcard. The
public webhook Edge endpoint has Supabase gateway JWT verification disabled only because
Asaas does not send a Supabase JWT. The handler instead performs constant-time
validation of the independent `asaas-access-token`, restricts payload size, validates
JSON and stores only:

- provider/environment/event ID/type;
- SHA-256 of the raw payload;
- technical checkout/customer/payment/subscription IDs;
- opaque internal order reference;
- billing due date needed to derive the paid period.

It does not persist new raw payloads, amounts, descriptions, card data or personal
details. Idempotency is enforced by
`(provider, environment, external_event_id)`. Equal event IDs in Sandbox and production
remain separate namespaces; a replay inside Sandbox is a no-op.

Event actions:

| Action | Events |
| --- | --- |
| `grant_activate` | `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` |
| `grant_grace` | `PAYMENT_OVERDUE` |
| `grant_revoke` | full refund/undo and chargeback events |
| `administrative_review` | `PAYMENT_PARTIALLY_REFUNDED` |
| `informational` | creation, checkout lifecycle, subscription metadata, refund in progress/denied and unknown events |

`CHECKOUT_PAID` is intentionally informational. The transactional database processor
locates the order by the opaque reference or known payment/subscription ID, refuses ID
or customer mapping conflicts, derives APP paid-through from the Asaas due date and
offer cycle, and creates APP/KNOWLEDGE grants only once. COMPLETE continues to create
two independent grants.

For subscriptions, the order retains the initial acquisition payment ID while each
renewal is reconciled by the stable subscription ID. A later renewal refund or
chargeback affects APP access but preserves COMPLETE's lifetime KNOWLEDGE grant; a
refund or chargeback of the initial acquisition can revoke both linked grants.

## Future isolated connection procedure

The next window requires explicit authorization for a non-production Supabase project
and Asaas Sandbox account:

1. apply the separately approved Commercial Access migration to the isolated database;
2. set the server-only secrets/configuration above through the secret manager;
3. deploy `asaas-checkout` with JWT verification enabled;
4. deploy `asaas-webhook` with gateway JWT verification disabled and its independent
   provider token check enabled in code;
5. use the public HTTPS URL
   `https://<NON_PRODUCTION_PROJECT_REF>.supabase.co/functions/v1/asaas-webhook`;
6. register only the required payment, subscription and checkout events in Asaas
   Sandbox, preferably with sequential delivery;
7. run the read-only/configuration checks, then execute the homologation script with a
   synthetic customer and cleanup:

```zsh
node scripts/homologate-asaas-sandbox.mjs --execute --cleanup
```

The initial Sandbox webhook allow-list is:

```text
PAYMENT_CREATED
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
PAYMENT_OVERDUE
PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
PAYMENT_DELETED
PAYMENT_REFUNDED
PAYMENT_PARTIALLY_REFUNDED
PAYMENT_REFUND_IN_PROGRESS
PAYMENT_REFUND_DENIED
PAYMENT_RECEIVED_IN_CASH_UNDONE
PAYMENT_CHARGEBACK_REQUESTED
PAYMENT_CHARGEBACK_DISPUTE
PAYMENT_AWAITING_CHARGEBACK_REVERSAL
SUBSCRIPTION_CREATED
SUBSCRIPTION_UPDATED
SUBSCRIPTION_INACTIVATED
SUBSCRIPTION_DELETED
CHECKOUT_CREATED
CHECKOUT_CANCELED
CHECKOUT_EXPIRED
CHECKOUT_PAID
```

The webhook registration must use the independent token as `authToken`; it must be
32–255 characters and must not equal the API key. No registration request is included
or executed in this branch until the public HTTPS endpoint and remote authorization are
both available.

The script first probes authentication, then creates only a synthetic Sandbox customer
and checkout. It refuses missing credentials, a production-prefixed key, a non-Sandbox
environment or a different base URL before network access. Cleanup cancels the checkout
before requesting removal of the synthetic customer; if Asaas refuses cleanup, the
script reports that manual Sandbox review is required without printing IDs or data.

## Sources checked for this local contract

- [Asaas authentication](https://docs.asaas.com/docs/authentication)
- [Asaas Checkout](https://docs.asaas.com/docs/asaas-checkout)
- [Asaas customer creation](https://docs.asaas.com/reference/create-new-customer)
- [Asaas payment webhooks](https://docs.asaas.com/docs/webhook-para-cobrancas)
- [Asaas webhook delivery/security](https://docs.asaas.com/docs/about-webhooks)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
