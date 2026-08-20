# Isolated V82 Beta preparation

This directory contains synthetic local-only preparation assets. Nothing here may be
run against production or a linked project.

## Database prerequisites

The reviewed V82 migration is additive and assumes the V81 application schema already
exists. A new isolated Beta project therefore needs an approved **schema-only V81
baseline** obtained through an administrative process after the remote security
checkpoint. The minimal local baseline is not eligible for Beta or production.

Future order:

1. provision an empty, isolated Supabase Beta project;
2. install an approved schema-only V81 baseline, without rows or personal data;
3. build a clean migration folder with `scripts/prepare-beta-migrations.js`;
4. apply only the files allowed by `supabase/production-migrations.manifest`;
5. review explicit Data API grants and RLS;
6. create synthetic Auth users through the Beta administrative interface;
7. apply equivalent synthetic application fixtures;
8. run A/B ownership, RPC and acceptance tests.

`seed.synthetic.local.sql` is executable only against the disposable local CLI database.
It inserts directly into `auth.users`, which is not the future hosted Auth provisioning
procedure. It exists to test data separation and structured IDs locally.

Planning, categories and the Reserve ledger are represented in
`tests/fixtures-beta-v82.js`: the Stage 12 local baseline intentionally does not recreate
the complete production schema, and the Reserve ledger remains localStorage-based.

## Frontend artifact

`scripts/prepare-beta-artifact.js` requires these environment variables:

- `MB_BETA_SUPABASE_URL`
- `MB_BETA_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...` only)
- `MB_BETA_AUTH_REDIRECT_URL`

The script builds a separate artifact, strips embedded legacy frontend connection
values, and injects only the isolated Beta public configuration. It never accepts a
service-role/secret key and does not print values.

Until such an artifact exists, the committed Beta frontend is fail-closed and shows an
explicit configuration-blocked screen instead of falling back to another Supabase.
