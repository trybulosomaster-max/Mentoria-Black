# Mentoria Black — V82 Beta acceptance

Status gate: `CREDENCIAL_TEMPORARIA_CONFIRMADA = NÃO`.

No remote provisioning, deploy, linked CLI command or production access is authorized
while that value remains `NÃO`.

## Hosting and isolation

No deployment workflow or provider configuration is versioned in this repository.
There are no GitHub Actions, Pages, Vercel, Netlify or `.openai/hosting.json` files.
Production branch configuration points to `main`, but external provider hooks cannot be
excluded without a separately authorized remote audit. Therefore this branch must not be
pushed yet.

The Beta artifact is fail-closed. It displays `Mentoria Black — V82 BETA`, never falls
back to the embedded legacy Supabase configuration, and is generated with a distinct
Beta URL and `sb_publishable_` key. Production data and service-role keys are forbidden.

## E2E matrix

| Scenario | Initial data | Action | Expected result | Screens/database | Risk | Rollback |
|---|---|---|---|---|---|---|
| New user | Empty isolated account | Sign in and visit all tabs | Empty states; Health says insufficient data | All/Auth | Medium | Delete Beta user |
| Synthetic legacy | Nullable links and known/unknown statuses | Load and filter period | Unknown stays unclassified; no silent realized effect | Dashboard/Reports | High | Restore Beta snapshot |
| Long goal | Casamento fixture | Open goal and Dashboard | Long virtual projection, explicit coverage, no duplicate | Goals/Dashboard | Medium | Delete fixture goal/rule |
| Recurrence | Materialized occurrence plus matching rule | Project selected period | Materialized wins over virtual | Goals/Planning/Reports | High | Delete synthetic series |
| Installment | Two legitimate similar purchases and one duplicate | Load/report month | Legitimate rows stay; structural duplicate rejected | Transactions/Reports/DB | High | Delete synthetic series |
| Planning | August plan and movements | Open current/future month | Five columns stay separate | Planning/Dashboard | Medium | Remove plan fixture |
| Reports | Mixed types/states | Combine period/type/category filters | Rows, totals and print match filters | Reports | Medium | Revert Beta artifact |
| Dashboard | Same fixture as detailed pages | Compare summaries | Goals/Planning/KPIs equal detailed engines | Dashboard | High | Revert Beta artifact |
| Reserve | Contributions and withdrawal | Open Reserve | Effective ledger only; target/falta/cobertura correct | Reserve/localStorage | Medium | Clear Beta ledger key |
| Health | Partial and complete fixtures | Open Health | Partial renormalization; no artificial fallback | Health | Medium | Clear Beta fixtures |
| Accounts | Opening balances and effective movements | Reconstruct balances | Explainable deltas; no snapshot double count | Accounts/model | Critical | Keep model read-only |
| Transfer | Two owned accounts | Retry same operation ID | One atomic neutral operation | RPC/transactions | Critical | Structured reversal |
| Investment | Owned account and asset | Execute structured investment | Availability down, asset up, net worth neutral | RPC/transactions | Critical | Structured reversal |
| Rescue | Owned asset and destination | Execute structured rescue | Availability up, asset down, not income | RPC/transactions | Critical | Structured reversal |

## Mandatory goal fixtures

### Casamento

- target: R$ 50.000;
- deadline: 01/10/2031;
- contribution: R$ 550/month;
- two realized contributions;
- twelve controlled materialized occurrences;
- remaining eligible dates projected virtually through the deadline.

Confirm Realizado, Programado, Projetado, Cobertura prevista, Falta para Meta,
Falta planejar, conclusion status and zero materialized/virtual duplication.

### Viagem JP

- target: R$ 8.000;
- deadline: 01/08/2028;
- contribution: R$ 550/month;
- one realized contribution;
- six controlled materialized occurrences.

The separate no-deadline fixture must produce zero long projection unless the caller
supplies an explicit horizon. No arbitrary date may be invented.

## Mobile checklist

- Dashboard cards, forecast labels and navigation.
- Goals: all six canonical values, deadline and completion forecast.
- Planning five-column table and horizontal overflow.
- Report filters, table overflow and print entry point.
- Reserve and Health partial/no-data messages.
- Transactions form, date/type/category/account/card inputs.
- All modals: focus, close, scrolling and keyboard behavior.
- Buttons: tap target, disabled/loading state and duplicate submission.
- Portrait and landscape layout; no clipped currency or inaccessible action.
- Browser console: no new error; service-worker cache identifies `v82-beta`.

## Desktop Safari checklist

- Login/session recovery and navigation across every tab.
- Dashboard/Planning charts render once and resize correctly.
- Forms validate without duplicate submit.
- Modals trap usable focus and remain scrollable.
- Tables, filters and print preview preserve active selection.
- Goal, Planning and Report totals match the same fixture.
- Console contains no critical error or sensitive event payload.
- Hard refresh and service-worker update keep the V82 Beta badge/configuration.

## Privacy-safe observability

`js/beta-observability.js` keeps at most 100 events in memory. It sends nothing over
the network and stores nothing in localStorage. UUIDs, e-mails and currency-like values
are redacted. Captured categories include JavaScript/unhandled errors, Supabase HTTP
failures, RLS/Auth denials, duplicate rejection, network failure and projection warning.

## Administrative credential procedure

1. In the approved Supabase organization/project dashboard, open database connection
   credentials without using the previously displayed value.
2. Rotate/revoke the temporary database credential or confirm its documented expiry.
3. End any sessions created by that credential when the platform exposes that control.
4. Record only confirmation, operator, timestamp and ticket/reference — never the value.
5. Set `CREDENCIAL_TEMPORARIA_CONFIRMADA = SIM` only after independent confirmation.

After confirmation, a separately authorized task may provision an isolated Beta project,
install an approved schema-only V81 baseline, apply the manifest migration, create
synthetic Auth users, run RLS A/B, build the frontend artifact and publish a separate URL.
