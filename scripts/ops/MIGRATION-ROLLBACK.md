# Migration rollback procedure (REL-020)

Companion to `scripts/ops/migrate-rollback.sh`. Read this before running that
script against anything other than a disposable test cluster.

## The gap this closes

Every one of this fleet's 65 services (`services/*/migrations/`) ships
hand-written, idempotent, **forward-only** `*.sql` migrations, applied in
filename order by `scripts/dev/migrate-all.mjs` (dev) and
`scripts/ci/bootstrap-postgres.sh` (CI). Confirmed before writing any of this:

- **No migration ledger exists anywhere.** No `schema_migrations` table, no
  `__drizzle_migrations`, nothing — grepped across `packages/`, `scripts/`,
  `infra/`. `drizzle-kit` is a devDependency of `packages/db` and five
  services carry a `drizzle.config.ts` (admin, finance, hrms, procurement,
  tenant), but none of that is wired into an actual `drizzle-kit migrate`
  journal flow; `location-service` has a `db:migrate: drizzle-kit push`
  script, which diffs `schema.ts` directly and keeps no history either. The
  only "current state" that exists anywhere is *whatever the database
  happens to contain right now*.
- **No down-migrations existed before this change.** Grepped every
  `services/*/migrations/` for `*.down.sql` / a `down/` directory / anything
  named `*rollback*` — nothing. Forward-only was the entire story.
- **However — 63 of the 65 services already document the reversal in
  prose.** Every migration template in this codebase carries a header
  comment, and most already include a line like:
  ```
  -- Rollback: DROP SCHEMA vendor CASCADE;
  ```
  or, for a later ALTER-style migration:
  ```
  -- Rollback: ALTER TABLE vendor.vendor_licences DROP COLUMN fee_paid, DROP COLUMN fee_transaction_id;
  ```
  (`grep -rl "^-- Rollback:" services/*/migrations/*.sql` finds this in 63 of
  65 services' migration sets.) The intent was already there; it was just
  never a real, tooled, *executed* file. That is the gap this change closes:
  formalize the comment into a runnable, transaction-safe down-migration, and
  build the tool that applies it.
- `scripts/rollback.sh` (REL-012) and `scripts/ops/{backup-databases,
  restore-drill}.sh` already exist but solve different problems: the former
  is an **application/process** rollback (pm2 reload + snapshot untar, no
  database involved), the latter is a **whole-database** backup/restore
  (point-in-time, all tables, no way to target one migration). Neither
  touches "undo the last schema change for one service." This does.

## Convention: `migrations/down/<same-basename>.sql`

For a migration `services/<svc>/migrations/NNNN_name.sql`, its reversal (if
authored) lives at `services/<svc>/migrations/down/NNNN_name.sql` — same
filename, sibling `down/` directory.

**Why a subdirectory, not `NNNN_name.down.sql` next to the up-file:** both
`scripts/dev/migrate-all.mjs` (`readdirSync(migrationsDir).filter(f =>
f.endsWith(".sql"))`) and `scripts/ci/bootstrap-postgres.sh` (`find
"$mig_dir" -maxdepth 1 -name '*.sql'`) glob every `*.sql` file directly in
`migrations/` and forward-apply it. A `NNNN_name.down.sql` sibling would
match that glob too — and sorts **before** `NNNN_name.sql` lexicographically
(`.down.sql` < `.sql` at the first differing character, `d` < `s`), so it
would be applied *before* the migration it's meant to reverse, on every
fresh bootstrap. That is not a hypothetical: it was checked against both
tools' actual glob code before picking this convention. A `down/`
subdirectory is invisible to both (`readdirSync` returns the directory entry
`"down"`, which fails `.endsWith(".sql")`; `find -maxdepth 1` never
descends into it), so existing forward tooling needs zero changes and stays
completely blind to rollback files. `tests/ops/migrate-rollback-down-files.test.ts`
(added with this change) guards this property directly.

## "Most recently applied" without a ledger

`scripts/ops/migrate-rollback.sh --service <name>` (no `--migration`) infers
the target as **the highest-numbered `*.sql` file directly in
`migrations/`** — the same filename-order assumption `migrate-all.mjs` and
`bootstrap-postgres.sh` already make when they forward-apply "everything in
order". This is correct whenever the database is fully up to date, which is
the normal case for a service you're about to roll back.

It is **not** reliable when:
- **Migrations are numbered non-sequentially.** `tenant-service` has two
  `0015_*.sql` files (`0015_org_hierarchy_real.sql` and
  `0015_placement_policy.sql`); `location-service` has `0005_*`, `0005a_*`,
  `0005b_*`. The tool detects a duplicate leading number and **refuses to
  guess** — pass `--migration <basename>` explicitly.
- **The database is known to be behind** (some migrations never applied,
  applied out of order, etc.) — again, use `--migration` to name the exact
  file rather than trusting the default.

`--list` shows every migration for a service and whether a down-migration
exists for it yet, without connecting to any database:
```
scripts/ops/migrate-rollback.sh --service vendor-service --list
```

## Running it

```
scripts/ops/migrate-rollback.sh --service <name> [--migration NAME] \
  [--role ROLE] [--db NAME] [--password PW] \
  [--list] [--dry-run] [--yes] [--no-backup]
```

Connection env vars match `bootstrap-postgres.sh`: `PGHOST` (default
`localhost`), `PGPORT` (default `5435`), `PGUSER`/`PGPASSWORD` (superuser,
only used if the down-migration itself creates/alters a role), `BACKUP_DIR`
(default `~/civitas-backups`).

**Default role/db derivation** matches every entry in
`bootstrap-postgres.sh`'s `SERVICE_DBS` map: strip the service's trailing
`-service`, `-` → `_`, role = `<base>_svc`, db = `civitas_<base>` (e.g.
`identity-service` → role `identity_svc`, db `civitas_identity`). The
default password follows that same script's own dev convention
(`sed 's/_svc/_dev_pw/'` on the role name) — **a dev/CI convention only**;
in any real environment pass `--password` (or set `PGPASSWORD`) explicitly.

**Exception:** `ADMIN_OWNED_DBS` services in `bootstrap-postgres.sh`
(`court-service`, `inspection-service`, `ml-service`, `revenue-service`,
`works-service`) have schemas owned by `civitas_admin`, not `<svc>_svc` —
their service role holds only `USAGE`+DML, not `ALTER`/`DROP` rights on its
own tables. Roll back those with `--role civitas_admin --password <admin pw>`.

**Safety model**, in order:
1. Prints exactly what will run (service, migration, target `host:port/db`,
   role) before doing anything.
2. Interactive `type 'yes'` confirmation unless `--yes` is passed.
3. Schema-only `pg_dump` snapshot to `$BACKUP_DIR/rollback-pre-<service>-<migration>-<timestamp>.schema.sql`
   (best-effort convenience — a human diff target — not the real safety net;
   skip with `--no-backup`).
4. The down-SQL runs via `psql -1 -v ON_ERROR_STOP=1` — **single transaction,
   stop on first error.** If the down-migration references an object that
   doesn't exist (e.g. the up-migration it claims to reverse was never
   actually applied), that statement errors and the whole transaction is
   discarded — nothing is committed. This was verified empirically, not just
   assumed from the psql docs — see "Verification" below.

## Verification (2026-09-15)

Ran end-to-end against a disposable, throwaway Postgres container — never
the shared dev cluster on port 5435, and never any other agent's named
container on this host:

```
docker run -d --name pg-rel020 -e POSTGRES_USER=civitas \
  -e POSTGRES_PASSWORD=civitas_test -e POSTGRES_DB=postgres \
  -p 5620:5432 postgres:16-alpine

PGHOST=localhost PGPORT=5620 PGUSER=civitas PGPASSWORD=civitas_test \
  PGDATABASE=postgres POSTGRES_ADMIN_PASSWORD=civitas_test \
  bash scripts/ci/bootstrap-postgres.sh
```

This is the exact recipe `bootstrap-postgres.sh`'s own header comment
already documents for regenerating its migration-failure allow-list against
a fresh cluster — reused as-is here rather than hand-rolling role/db
provisioning, since it is this repo's own existing, trusted way to stand up
every service's schema from nothing.

For each of `vendor-service`, `animal-service`, `identity-service` — chosen
to cover a small single-schema municipal service, a slightly larger one with
a sequence, and a large (24-migration) security-sensitive service:

1. **Apply** — already done by the bootstrap run above (forward migrations,
   all the way to each service's latest file).
2. **Confirm forward state** — queried the objects the target migration
   creates (see exact queries and output in the PR description / commit
   history for this change).
3. **Roll back**:
   ```
   PGHOST=localhost PGPORT=5620 scripts/ops/migrate-rollback.sh \
     --service vendor-service --yes
   ```
   (same for `animal-service`, `identity-service`).
4. **Confirm the schema returned to its prior state** — re-ran the same
   queries from step 2; the target migration's objects (columns / sequences
   / policies) were gone, and every *other* object created by earlier
   migrations for that service was untouched.
5. **Re-apply** the same migration file directly with `psql -f` (exactly
   what `migrate-all.mjs` does) and confirmed it succeeded cleanly a second
   time with no errors and no duplicate-object complaints — proving the
   up-migration is still idempotent after a rollback/reapply cycle.
6. **Negative case** — ran the rollback a *second* time in a row (i.e.
   attempted to roll back a migration whose objects no longer exist).
   Confirmed the down-SQL's first statement failed as expected (object does
   not exist) and, because of `psql -1`, the transaction aborted with no
   partial effect — the single-transaction safety net is real, not just
   documented.

Full command transcript and query output are in this change's PR
description.

## Extending this to the rest of the fleet

62 services don't yet have a `migrations/down/` directory (2 of this
change's 3 demo services did carry the reversal SQL already, as a comment —
see below). To add rollback support for another service:

1. Check whether the migration already documents its own reversal:
   ```
   grep "^-- Rollback:" services/<svc>/migrations/*.sql
   ```
   63 of 65 services have at least one migration with this comment already
   (`grep -rl "^-- Rollback:" services/*/migrations/*.sql`). Where it exists,
   it is usually the entire down-migration, verbatim — that is exactly what
   this change did for `vendor-service` (`0003_licence_fee_paid.sql`) and
   `animal-service` (`0002_number_sequences.sql`).
2. Where no comment exists (as for `identity-service`'s `0024_sec025_scim_tokens_rls.sql`
   in this change), read the up-migration and write the structural inverse:
   `DROP POLICY`/`DISABLE ROW LEVEL SECURITY` for policies added,
   `DROP COLUMN` for columns added, `DROP TABLE`/`DROP SCHEMA` for tables or
   schemas created, `DROP SEQUENCE` for sequences, etc. Use `IF EXISTS` on
   every drop so the file is itself safe to run against a database where the
   up-migration was never applied (the enclosing `psql -1` transaction is
   the actual guarantee, but `IF EXISTS` avoids a spurious-looking error in
   the common case).
3. **Never drop a column or table that may hold data written after the
   up-migration ran** without first confirming that data loss is actually
   intended — a rollback executed weeks after the forward migration is not
   the same operation as one executed a minute after. This tool executes
   what you tell it to; it does not make that judgment call for you.
4. Add the file at `services/<svc>/migrations/down/NNNN_name.sql` (same
   basename as the up-migration) and verify with `--dry-run`, then a real
   run against a disposable cluster — never the first time in production.
5. `services/<svc>/migrations/README.md` (present for some services, e.g.
   `tenant-service`) is a reasonable place to note that down-migrations now
   exist for this service and where.

This change deliberately does not retroactively author down-migrations for
all 65 services — see the PR description for why (scope), and the count
above for how much of the underlying work already exists as an unexecuted
comment.

## Non-goals / known limitations

- **No ledger.** This still can't tell you "what has actually run" from the
  database alone — only from the filesystem. Adding a real
  `_schema_migrations` ledger (written transactionally by a rewritten
  forward-apply tool) would remove the "duplicate leading number" and
  "database known to be behind" caveats above, but is a bigger change than
  this gap calls for; noted here as the natural next step, not built.
- **Single migration at a time.** Rolling back N migrations means running
  this N times, newest-first, each requiring its own `down/` file. There is
  no bulk "roll back to migration X" mode.
- **Not a substitute for `scripts/ops/backup-databases.sh` /
  `restore-drill.sh`.** If a down-migration can't safely express the
  reversal (e.g. genuine, intended data loss on rollback, or a migration
  that isn't structurally invertible), restoring from a full backup is the
  correct tool, not this one.
