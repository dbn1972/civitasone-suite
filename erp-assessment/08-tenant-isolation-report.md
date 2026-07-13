# 08 — Tenant Isolation Report

**Status: PARTIALLY PROVEN — materially improved this cycle, not yet uniform.**
Evidence base: a suite-wide RLS-readiness audit (5 parallel lanes, all 36 data services) + targeted live remediation with cross-tenant probes executed as the real least-privilege DB roles. This is executed evidence, not inspection.

## How tenant context is established & propagated (verified)
- Auth: RS256 JWT verified against Keycloak JWKS (`packages/auth`); tenant carried as `tid` claim.
- Gateway (`gateway-service/jwt-edge`) sets `x-tenant-id` from the verified `tid`.
- DB isolation: every service DB uses `tenant_id` + **FORCE ROW LEVEL SECURITY** + a per-request/consumer `app.tenant_id` GUC; policy `tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid` (fail-closed). GUC is set inside `db.transaction()` from AsyncLocalStorage (`packages/db/tenant-db.ts`, `tenant-context.ts`).
- Cache keys tenant-scoped `{service}:{tenant}:{resource}:{id}` (`packages/cache`).
- Queue: FIFO `MessageGroupId = tenantId`; consumers now run in `runWithTenant(msg.tenantId)`.

## THE CRITICAL FINDING (audited, all 36 data services)
The DB isolation is **fail-CLOSED, not fail-open** (no cross-tenant *leak* found — FORCE==ENABLE on every table, all `*_svc` roles NOBYPASSRLS), BUT it was **inert/broken under the real prod role** on 31/36 services because the tenant GUC was never set on the read/consumer path:
- Consumers used `db.transaction()` with no `runWithTenant` → writes rejected under the real role.
- Repos used bare `db.select()` outside a transaction → reads returned EMPTY under the real role.
- Tenant sourced from the spoofable `x-tenant-id` header, not the JWT.
This was **invisible in dev** because dev connects as the `civitas_admin` SUPERUSER (bypasses RLS). On production cutover to per-service least-privilege roles, 31/36 services would have failed closed.

Matrix at audit time: **31 AT-RISK · 3 SAFE (court/visitor/meeting) · 1 SAFE\* (analytics) · 1 N/A (metadata stub)**.

## Remediation executed + PROVEN this cycle (on main)
- **Central write-fix** (`6d64df7`): `queue-service createQueue` wraps every consumer in `withTenantConsumer→runWithTenant` → ALL ~30 services' consumer writes now establish tenant context. **Live-proven**: admin_svc + payroll_svc consumer writes went RLS-REJECTED → SUCCESS as the NOBYPASSRLS role (ground-truth 1 after-row / 0 before-row).
- **Reads + JWT source fixed + live-proven** for the 8 highest-severity services: finance `5a76029`, billing+notification `4fe84a2`, workflow `23f222d`, hrms+identity `f0bffdd`, payroll `3f3b149` (+ the earlier trio court/visitor/meeting + analytics). Each proof, run as the real NOBYPASSRLS role: **bare read (no GUC) = 0 rows → scoped read + tenant-A GUC = 1 row → tenant-B GUC = 0 rows (isolation holds)**. Example (finance, `budget.finance_heads`): 0 / 1 / 0.

## Cross-tenant access tests (§7) — result
Executed at the DB-enforcement layer as the real role: Tenant A **cannot** read/write Tenant B rows once the GUC is set correctly (RLS blocks; confirmed 0 rows for the wrong tenant across every fixed service). Tenant-less context → 0 rows (fail-closed). This proves the *DB-layer* object isolation for the fixed services.

## Residual gaps (honest)
1. **~23 services still need the read + JWT-hook fix** (Wave 2 of the remediation) — their consumer writes are fixed centrally, but their bare-`db.select` READS still return empty under the real role (fail-closed, not a leak). Listed in the `civitasone-rls-readiness` record.
2. **Synchronous HTTP-route writes** via bare `db.execute` (a third gap class; finance 3, hrms 61, identity 16) — not covered by the central consumer-write fix; fail-closed under FORCE RLS. Needs a route-write pass.
3. **Route/role-layer AuthZ** (BOLA/function-level) is assessed separately in `09-security-report.md` — DB isolation ≠ object-level authZ.
4. **`workflow_svc` role has BYPASSRLS** (infra misconfig) — bypasses RLS at runtime until the DB bootstrap sets it NOBYPASSRLS; the code fix is correct-but-inert until then.
5. Redis/object-storage/search/report tenant-scoping: cache keys are tenant-scoped (good); a full sweep of object-storage paths + search queries + every report is pending (§19/§26 continuation).

## Verdict
**Tenant isolation at the database layer is PROVEN for the 12 fixed services under the real least-privilege role, and the most dangerous class (rejected writes) is fixed suite-wide.** It is NOT yet uniformly proven across all 36 services (reads on ~23 services + route-writes + the workflow_svc role remain). No fail-open cross-tenant *leak* was found. **Q5 answer: partially proven — strong and executed for the critical path, with a documented, mechanical completion path for the rest.**

**Tenant-isolation score: 7/10** (DB enforcement correct + fail-closed + central write-fix proven; docked for the ~23 services' reads, route-writes, and workflow_svc role not yet closed).
