# RLS Engagement Runbook (Platform Review R1)

**Goal:** make Postgres Row-Level Security an *actually enforced* tenant-isolation
backstop (today it is dormant — the `app.tenant_id` GUC is never set, and
services run under a role that bypasses RLS).

**Why a runbook, not a single PR:** engaging RLS incorrectly breaks every query
fleet-wide. It must be sequenced so isolation turns on only after the GUC is wired
and a non-bypass role is in place — per service, behind a verifiable test.

> Status of sibling Wave-A items: **R3 (TRUNCATE guards) DONE & verified**;
> **R2 (no superuser DSN fallback) DONE**. R1 is sequenced below.

---

## Current state (verified)
- `current_tenant_id()` is defined in 17 services; **inconsistent**: some use
  `current_setting('app.tenant_id', false)` (raises if unset) — billing, citizen,
  contract, finance, grant, payroll, procurement, stock, workflow, … — others use
  `, true` (returns NULL if unset).
- **No service `src/` sets the GUC** — `withTenantScope`/`setTenantGuc`
  (`packages/db/src/tenant-scope.ts`) have zero call sites.
- Services connect as a role that **bypasses RLS** (prod compose previously
  defaulted to the cluster superuser — fixed in R2; dev role bypasses).
- Therefore isolation = application-layer `WHERE tenant_id = $1` only.

---

## Sequenced rollout (must follow order)

### Step 1 — Standardize `current_tenant_id()` to the missing-ok variant (safe, no runtime effect today)
Redefine every `current_tenant_id()` to:
```sql
SELECT current_setting('app.tenant_id', true)::uuid   -- NULL when unset (deny), never raises
```
`, true` makes an unset GUC return NULL → policy `tenant_id = NULL` is false →
rows are hidden / writes blocked, rather than a hard error. This removes the
"un-runnable under a least-priv role" foot-gun (Review S4). No effect while the
role still bypasses RLS, so it is safe to ship first.
*Generate one `..._rls_fix_current_tenant_id.sql` per affected service* (the
function lives in that service's first schema, e.g. `budget.current_tenant_id`).

### Step 2 — Wire the GUC at every DB-access boundary (the real work)
RLS only sees the GUC inside the same transaction (pooled connections — must be
`SET LOCAL`). Two integration points per service:
- **Routes/queries (reads):** wrap read transactions, or route reads through a
  helper that issues `SELECT set_config('app.tenant_id', $tenant, true)` first.
- **Consumers (writes):** replace `db.transaction(fn)` with
  `withTenantScope(db, tenantId, fn)` (already in `packages/db`). The command
  envelope already carries `tenantId`.
Most reads today are non-transactional `db.select()…` — those must move into a
tenant-scoped transaction (or a `withTenantScope` read wrapper). This is the
bulk of the effort and is done **per service**, lowest-risk first
(estab → finance → grant → … ), each behind the Step-4 test.

### Step 3 — Switch each rolled-out service to a non-bypass role
Run the service as its dedicated `*_svc` login role (NOT superuser, NOT
`BYPASSRLS`). R2 already removed the superuser fallback in prod compose;
`scripts/dev/grant-all.mjs` must grant least-privilege (and **not** `GRANT ALL` —
see R3) and the role must not have `BYPASSRLS`. Verify:
`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE '%_svc';`

### Step 4 — Prove it with a CI integration test (per service, blocking)
On a FORCE-RLS table, under the non-bypass role:
1. GUC unset → query returns 0 rows / write rejected (backstop live).
2. GUC = tenant A → only tenant A rows visible; insert with tenant B id rejected.
3. GUC = tenant B → only tenant B rows.
Add to `tests/` and to the CI `coverage-gate`/integration job. This is the gate
that authorizes flipping each service to Step 3.

### Step 5 — Decommission the bypass
Once all services pass Step 4, ensure no environment runs services as a
bypassing role; add a startup assertion (`SELECT rolbypassrls` must be false in
prod) and a migration-drift check that RLS is enabled+forced on every
tenant-scoped table.

---

## Guardrails
- Never enable Step 3 for a service before Step 2+4 are green for it.
- Keep the application-layer `WHERE tenant_id` predicate — RLS is the *backstop*,
  not a replacement (defense-in-depth).
- The `tenant-router` silo path (separate DB per silo tenant) is orthogonal: silo
  tenants are isolated by the DB boundary; RLS still applies harmlessly.

## Definition of done
All tenant-scoped tables FORCE RLS + a wired GUC + non-bypass roles + a passing
cross-tenant rejection test per service, with the bypass decommissioned in prod.
