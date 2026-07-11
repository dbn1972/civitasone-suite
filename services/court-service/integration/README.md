# court-service — runtime integration gate

Unit tests (`vitest`) mock the database, so they prove the domain/consumer logic but
**not** that the migrations enforce their invariants against a real Postgres. This
directory closes that gap: it stands the migrations up on a real cluster and proves,
**as the least-privileged `court_svc` role (NOT a superuser)**, that:

1. **Tenant isolation (RLS)** actually enforces at runtime — `rls_proof.sql`.
2. **Courtroom double-booking** is impossible — the `btree_gist` EXCLUDE constraint —
   `exclude_proof.sql`.

> Why the non-superuser role matters: a superuser (or a `BYPASSRLS` role) is *never*
> subject to row-level security. A test that runs its assertions as a superuser will
> pass even when every RLS policy is wrong or missing. `court_svc` is created
> `NOSUPERUSER NOBYPASSRLS` so the policies are genuinely exercised — the service
> connects with exactly this grant in production.

## Run

```bash
# 1. bootstrap: create the non-superuser role + db + extensions, apply all migrations
./run.sh            # wraps the docker exec psql calls below

# or manually, against the shared civitasone-postgres cluster (superuser civitas_admin):
#   CREATE ROLE court_svc LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
#   CREATE DATABASE civitas_court;
#   \c civitas_court
#   CREATE EXTENSION IF NOT EXISTS btree_gist;  CREATE EXTENSION IF NOT EXISTS pgcrypto;
#   \i migrations/0001_court_core.sql   ... through 0005
#   GRANT USAGE ON SCHEMA court TO court_svc;
#   GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA court TO court_svc;

# 2. prove RLS as court_svc  (expect: isolation holds, spoofed insert rejected, fail-closed)
psql -U court_svc -d civitas_court -f rls_proof.sql

# 3. prove the double-booking guard  (expect: 2nd identical slot/courtroom fails 23P01)
psql -U civitas_admin -d civitas_court -f exclude_proof.sql
```

## Expected results (verified 2026-07-11)

`rls_proof.sql` — as `court_svc` (super=f, bypassrls=f):
- tenant A inserts + sees its own row (1)
- tenant B sees **0** of A's rows
- spoofed insert (`tenant_id=A` while GUC=B) → `ERROR: new row violates row-level security policy`
- cross-tenant UPDATE / DELETE → **0 rows**
- empty `app.tenant_id` GUC → **0 rows** (fail-closed via `NULLIF`)

`exclude_proof.sql`:
- (a) first item into (slot 2, courtroom 3) → `INSERT 0 1`
- (b) second item, same (tenant, list_date, slot, courtroom) → `ERROR ... exclusion constraint "cause_list_items_no_double_booking"` (SQLSTATE 23P01)
- (c) different courtroom, same slot → `INSERT 0 1`
- final item count = **2**

Both proofs must produce these results before the service is considered runtime-ready.
The consumer maps the 23P01 (and 23505) violation to a `NonRetryableError`
(`CAUSELIST_SLOT_CONFLICT`) so the double-booking is surfaced as a clean 409-class
failure, not an infinite retry.
