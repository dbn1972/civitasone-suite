# CivitasOne — SAST Remediation Report

**Date:** 2026-06-27
**Source audit:** `docs/security/SAST-FINDINGS-2026-06.md` (pre-fix score 58/100, verdict FAIL)
**Remediation by:** Security engineering teams (multi-tenant isolation + identity/authz specialists)

---

## Summary

All 8 SAST findings addressed. The two release-blocking **High** findings (SAST-001, SAST-002)
are fully fixed with the finance-treasury defense-in-depth pattern. Mediums and Lows fixed or
provided as tested, staged-rollout capability (SAST-003).

| ID | Severity | Status | Fix |
|----|----------|--------|-----|
| SAST-001 | High | ✅ Fixed | Tenant scoping added to all `find*ById` + post-load guards + consumer ownership checks across 7 services |
| SAST-002 | High | ✅ Fixed | Policy evaluate now derives principal from `ctx`; client `actor` honored only behind internal-trust gate; `checkPermission` sends `x-service-secret` |
| SAST-003 | Medium | ⏳ Capability shipped | `withTenantScope`/`setTenantGuc` helpers added to `@civitasone/db`; staged rollout documented (requires DB-role verification) |
| SAST-004 | Medium | ✅ Fixed | JWT `audience` validated on RS256 prod path; fail-closed if unset in prod |
| SAST-005 | Medium | ✅ Fixed | Service-book HTML output-encoded (`escapeHtml`) + restrictive CSP header |
| SAST-006 | Low | ✅ Fixed | SMTP logging uses masked recipient via pino; SMTP user dropped; dry-run guarded |
| SAST-007 | Low | ✅ Fixed | Command payloads flipped to spread-first ordering across finance/hrms/legal |
| SAST-008 | Info | ✅ Acknowledged | Caret ranges mitigated by lockfile + frozen installs + CodeQL/audit; optional pinning recommended |

---

## SAST-001 — Cross-tenant BOLA/IDOR (High) — FIXED

Applied the correct pattern (from finance-treasury) to every confirmed and pattern-confirmed endpoint:
- **repo:** `findXById(id, tenantId)` → `where(and(eq(id), eq(tenantId)))`
- **query:** post-load guard `return row && row.tenantId === tenantId ? row : null`
- **mutation consumer:** `findXByIdTx(tx, id, tenantId)` + `if (!x || x.tenantId !== tenantId) throw "UNKNOWN_X"`

Services remediated:
| Service / Module | Endpoint | Read/Write |
|---|---|---|
| legal-service / cases | `GET/PATCH /v1/legal/cases/:id` | read + dispose |
| finance-service / treasury | `GET /v1/finance/banks/:id/balance` | read |
| policy-service / roles | `GET /policy/roles/:id`, `/:id/permissions`, `PATCH /policy/roles/:id` | read + update |
| stock-service / item | `GET /v1/stock/items/:id` | read |
| contract-service / rate | `GET /v1/contract/rate-contracts/:id` | read |
| procurement-service / auction | `GET /v1/procurement/auctions/:id`, bid/close consumers | read + write |
| notification-service / channels | `findChannelById` (latent) | read |

All 7 service typechecks pass. legal (28), finance (100), stock (11), contract (23), notification (54) tests green.

**Follow-up (separate pass):** other legal modules (counsel/filings/opinions/hearings) and admin/tenants still use `find*ById` without `tenantId` — not in the confirmed exposure set, recommended for a future audit.

## SAST-002 — Policy evaluate trusts client actor (High) — FIXED

`POST /v1/policy/evaluate` now derives the principal from the authenticated `ctx` by default. A
client-supplied `body.actor` is honored **only** when the caller proves internal-service identity
(`x-internal: 1` + `x-service-secret === INTERNAL_SERVICE_SECRET`). The gateway strips both headers
from external clients, so end users can never forge an actor. `packages/auth/permissions.ts`
`checkPermission` now sends `x-service-secret` so legitimate internal calls pass the fail-closed plugin.

## SAST-003 — RLS GUC not wired (Medium) — CAPABILITY SHIPPED, STAGED ROLLOUT

Added `withTenantScope(db, tenantId, fn)` and `setTenantGuc(runner, tenantId)` to `@civitasone/db`
(`packages/db/src/tenant-scope.ts`). These run `SELECT set_config('app.tenant_id', <uuid>, true)`
(transaction-local, UUID-validated) so RLS policies enforce as a backstop.

**Not flipped fleet-wide** because the live service DB-role `BYPASSRLS` attribute is NOT VERIFIABLE
from the codebase, and threading it through 33 services blind is high-risk. Rollout is staged:
1. Verify service roles are non-superuser, non-BYPASSRLS (`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles`).
2. Confirm FORCE-RLS migrations applied.
3. Wrap tenant-scoped transactions in `withTenantScope`.
4. Add an integration test proving a GUC-less query is rejected on a FORCE-RLS table.

The primary control (app-layer tenant scoping, SAST-001) is now in place; this is the secondary backstop.

## SAST-004 — JWT audience (Medium) — FIXED
RS256 prod path now validates `audience` (`JWT_AUDIENCE` ?? `KEYCLOAK_CLIENT_ID`); fails closed in prod if unset.

## SAST-005 — Service-book stored XSS (Medium) — FIXED
All interpolated DB fields HTML-encoded; restrictive CSP added to the response.

## SAST-006 — PII in logs (Low) — FIXED
SMTP sender logs masked recipient via pino; SMTP user removed; dry-run debug guarded to non-prod.

## SAST-007 — Mass-assignment ordering (Low) — FIXED
Command payloads flipped to `{ ...body, id, tenantId }` (spread-first) in finance/hrms/legal.

## SAST-008 — Dependency ranges (Info) — ACKNOWLEDGED
Mitigated by committed lockfile + `--frozen-lockfile` + weekly `pnpm audit` + CodeQL. Optional: pin `jsonwebtoken`/`jwks-rsa` exactly.

---

## Verification

- **Typecheck:** db, auth, legal, finance, policy, stock, contract, procurement, notification, hrms — all ✅
- **Tests:** legal 28✓, finance 100✓, hrms 265✓, stock 11✓, contract 23✓, notification 54✓.
  Two failures (policy dedup timing, procurement PO/finance commitment) confirmed **pre-existing** (reproduce on baseline without these changes).
- **Re-score (post-fix estimate):** 2 High resolved + 3 of 4 Mediums fixed → projected **≥ 85/100**, 0 Critical/High. Recommend re-running the SAST review on the diff to confirm the gate flips to PASS.

## Residual risk
- SAST-003 RLS not yet enforced at the DB layer (capability shipped; staged rollout pending DB-role verification).
- Follow-up tenant-scoping audit for legal counsel/filings/opinions/hearings modules.
