# Mentoria Black Commercial Access V1

Status: local architecture proposal. No remote Supabase change, deploy, charge, webhook
registration or production configuration is authorized by this document.

## Versioned-state audit

The V82 `main` branch contains Supabase Auth login, signup, password reset, logout,
owner-scoped financial tables, RLS and structured financial RPCs. It does **not**
contain versioned definitions for `products`, `access_grants`, `payment_events`,
`has_active_access`, Kiwify adapters, payment webhooks or Edge Functions.

The current browser flow calls `signUp` directly. After authentication, `start()`
immediately loads every financial table. A registered user without a commercial grant
therefore receives the same application-loading path as any other user. The current
RLS protects user A from user B, but does not distinguish entitled from non-entitled
users.

Reusable foundations:

- one Supabase Auth identity and existing password/session flows;
- `user_id` ownership and composite ownership foreign keys;
- least-privilege client grants introduced by V82;
- the existing `SECURITY INVOKER`/controlled-`search_path` RPC pattern;
- local pgTAP and disposable-Postgres test infrastructure.

The local V82 baseline intentionally excluded unrelated product/payment objects.
Consequently, absence in Git does not prove absence in the hosted database. Before a
remote migration, a read-only catalog preflight must reconcile any unversioned Kiwify
objects. The proposed migration fails closed if it finds an object with a canonical
name instead of overwriting it.

## Identity and product model

One `auth.users.id` represents the customer across all products. `APP` and
`KNOWLEDGE` are grantable entitlements. `COMPLETE` is a bundle/offer whose component
mapping expands to independent `APP` and `KNOWLEDGE` grants. This prevents a cancelled
bundle from becoming an opaque permission and supports future books, courses,
materials, mentoring and premium modules through catalog rows rather than scattered
frontend constants.

Initial offers are seeded inactive and contain no price or provider identifier:

| Offer | Billing | Result |
| --- | --- | --- |
| `APP_MONTHLY` | monthly subscription | `APP` grant |
| `APP_ANNUAL` | annual subscription | `APP` grant |
| `KNOWLEDGE_LIFETIME` | one-time | lifetime `KNOWLEDGE` grant |
| `COMPLETE_MONTHLY` | monthly subscription | `APP` + `KNOWLEDGE` grants |
| `COMPLETE_ANNUAL` | annual subscription | `APP` + `KNOWLEDGE` grants |

The two COMPLETE offers are marked `COMMERCIAL_DECISION_REQUIRED` for the unresolved
question of whether KNOWLEDGE survives APP subscription cancellation.

## Entitlements and access grants

`access_grants` is an append/history-oriented entitlement ledger. It supports
`paid`, `trial`, `manual` and `lifetime` access, provider-neutral sources such as
`asaas`, `kiwify`, `hotmart`, `eduzz`, `manual` and `trial`, and lifecycle states
`active`, `grace_period`, `past_due`, `expired`, `revoked`, `refunded` and
`chargeback`.

Only entitlement products may receive grants. COMPLETE is expanded into two rows.
Trial and provider references have uniqueness constraints. Manual grants require a
non-null administrator identity; ordinary clients have no insert/update/delete grant
on entitlement, trial or billing tables.

`get_my_entitlements()` accepts no user ID, uses `auth.uid()` and returns only the
current caller's APP/KNOWLEDGE state plus `server_now`. `has_active_access(text)` is
the shared server-side predicate. Both are `SECURITY INVOKER`.

The nine private financial tables retain ownership checks and additionally require
an active APP entitlement. Expiration never deletes financial data; RLS makes it
unavailable until a paid/manual grant restores access.

## Seven-day trial

`start_my_app_trial()` is the deliberately narrow exception to the invoker preference.
It is `SECURITY DEFINER` because the operation must verify `auth.users.email_confirmed_at`
and atomically create server-controlled rows that the client cannot write. It:

1. accepts no user ID;
2. rejects unauthenticated or unconfirmed users;
3. locks per `auth.uid()`;
4. refuses a new-customer trial when non-trial APP history exists;
5. creates one APP trial and one grant with exactly `168 hours` between timestamps;
6. returns the existing trial on retry instead of restarting it.

Logout, localStorage deletion, PWA reinstall and browser changes cannot reset the
trial because its state is stored in Postgres. Recreating a session has no effect.
The resolver compares database timestamps with database time; browser time is only a
display input returned as `server_now`.

Privacy-first anti-abuse stops at one trial per Supabase user. A new email can create
a new identity. Stronger cross-account prevention requires a separately approved
identifier such as verified phone, CPF, or payment method. Device fingerprinting is
not proposed. Each stronger identifier adds privacy, retention and support duties.

## Browser contract

`commercial/access-contract.js` normalizes the RPC response, chooses one of
`app_trial`, `app`, `knowledge`, `complete`, `trial_expired` or `no_access`, and
calculates display-only remaining time from `server_now`.

The future frontend wiring order is:

1. authenticate once;
2. call `start_my_app_trial()` on the first eligible APP entry;
3. call `get_my_entitlements()`;
4. load financial tables only when `app.access` is true;
5. otherwise render the contracting screen without querying financial data;
6. expose only a public KNOWLEDGE sample unless `knowledge.access` is true.

The current `index.html` is intentionally not wired in this architecture-only stage.
That integration needs a focused UI change and local acceptance after this contract is
approved.

## Asaas sandbox architecture

The Asaas adapter is sandbox-only and ingest-only. No API key, webhook token, customer,
checkout, charge or subscription is created here. The Edge handler:

- refuses a non-sandbox environment;
- validates the `asaas-access-token` header using a server-side secret;
- rejects malformed or oversized bodies;
- hashes the exact payload with SHA-256;
- stores only technical identifiers, event type and hash, never the raw payload;
- uses `(provider, environment, external_event_id)` for at-least-once idempotency;
- does not grant access merely because a checkout redirected successfully.

`commercial/provider-contract.js` defines the provider-neutral server adapter surface
(`createCustomer`, `createCheckout`, `createSubscription`, `fetchPayment`) and permits
only explicit Sandbox checkout intents. Initial Asaas payment-method contracts cover
Pix and credit card; no network implementation or price is embedded in the browser.

Asaas currently documents distinct Sandbox and production credentials/URLs, an
authentication token in the `asaas-access-token` header, and at-least-once webhook
delivery with repeat event IDs. See:

- <https://docs.asaas.com/docs/sandbox>
- <https://docs.asaas.com/docs/sobre-os-webhooks>
- <https://docs.asaas.com/docs/webhook-para-cobrancas>
- <https://docs.asaas.com/docs/eventos-para-assinaturas>

Secrets belong only in Supabase Edge Function secret storage. The Asaas API key must
never be reused as the webhook token or shipped to the browser.

### Relevant event mapping

| Business condition | Asaas events | Internal effect after reconciliation |
| --- | --- | --- |
| confirmed/received | `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` | confirm order; activate/renew grants idempotently |
| overdue | `PAYMENT_OVERDUE` | `past_due`; apply configured grace policy |
| card failure | `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` | record failure; do not grant |
| cancelled/deleted | `PAYMENT_DELETED`, `SUBSCRIPTION_INACTIVATED`, `SUBSCRIPTION_DELETED` | cancel future renewal; policy controls current period |
| refund | `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_RECEIVED_IN_CASH_UNDONE` | `refunded`; revoke according to approved policy |
| chargeback | `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` | `chargeback`; suspend/reconcile explicitly |
| subscription lifecycle | `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED` | reconcile external subscription state |

Webhook ingestion and grant processing remain separate. A future worker must resolve
the event through `billing_orders`/`billing_customers`; it must never trust a user ID
or product code supplied by a public browser or redirect.

## Threat model

| Threat | Mitigation |
| --- | --- |
| modified frontend/direct REST call | entitlement-aware RLS on every financial table |
| self-created grant or changed expiry | no client write grants/policies on commercial tables |
| forged/cross-user ID | RPCs accept no user ID; RLS uses `(select auth.uid())` |
| unconfirmed-email trial | definer RPC checks `auth.users.email_confirmed_at` |
| trial replay/browser reset | unique server-side trial plus per-user advisory lock |
| forged webhook | strong server secret in `asaas-access-token`; optional Asaas IP allowlist |
| webhook replay | unique provider/environment/event ID and payload hash |
| duplicate grant | unique provider reference and transactional processor contract |
| redirect treated as payment | redirect is never authoritative; webhook/reconciliation only |
| knowledge without grant | future content API/storage policies must call the same entitlement predicate |
| chargeback/refund | explicit terminal states; no silent active grant |
| transient payment failure | configurable grace state; duration not hardcoded |
| user enumeration | generic Auth/commercial responses; never expose lookup-by-email RPC |
| leaked provider secret | no client secret; Edge secret storage and rotation runbook |

## Manual administration

Manual access is written only by a trusted administrative backend/service role after
administrator authorization. Every manual row records `granted_by`, time, optional
reason, expiry and revocation. No public self-service administration RPC is provided.
If an admin UI is added, the backend must authorize immutable `app_metadata` (not
user-editable metadata), record the administrator and expose no user enumeration API.

## Test matrix

The local suites cover or reserve explicit cases for:

- A/B/C/D: new user, unconfirmed email, atomic trial start and active trial;
- E/F/G: 167h59, exactly 168h and expired trial;
- H/I/J/K: monthly, annual, KNOWLEDGE and COMPLETE grants;
- L/M/N: manual access and persistence across session/browser changes;
- O/P: duplicate event and invalid webhook token;
- Q/R/S/T/U: overdue, renewal, cancellation, refund and chargeback classifications;
- V/W/X: no grant, cross-user isolation and client grant-write rejection.

All fixtures use reserved UUIDs and `.invalid` email addresses. No remote data or
credential is needed.

## Remote preflight and operational rollback

Before any remote application:

1. inventory existing product/payment/Kiwify tables, constraints, policies, grants,
   functions, triggers and data counts;
2. reconcile compatible objects or stop on semantic drift;
3. confirm Auth email confirmation behavior and recovery redirect URLs;
4. take a verified backup and approve a dedicated migration window;
5. apply this migration by explicit filename, never generic `db push`;
6. deploy the entitlement-aware frontend only after database tests pass.

Rollback is application-first: keep the current V82 frontend until the new database
contract is approved; if a later frontend fails, restore the V82 frontend and revoke
the new trial-start RPC. Do not delete grants, trials or customer financial data.
Because entitlement-aware RLS blocks V82 clients without grants, a remote rollback
must restore the prior owner-only policies transactionally before reverting the app.

## Commercial decisions still required

- prices, taxes, coupons and offer names;
- grace-period duration and retry cadence;
- whether COMPLETE's KNOWLEDGE access survives APP cancellation;
- refund/partial-refund and chargeback access policy;
- when cancellation stops APP access (immediate versus paid-through date);
- manual-access administrator identities and support process;
- stronger anti-abuse identifier, if any, with privacy/retention policy;
- public sample scope and future KNOWLEDGE content/storage architecture.

## Work possible before Asaas credentials

The schema, RLS, trial RPCs, entitlement resolver, browser contract, sandbox webhook
validation, event classification, idempotency tests and synthetic fixtures can all be
completed without an Asaas account. Checkout/customer creation, webhook registration,
end-to-end Sandbox events, reconciliation jobs and price mapping require a Sandbox
account and secrets supplied through approved server-side storage.
