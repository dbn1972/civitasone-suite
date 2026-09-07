# Skill — Security Beyond Tenancy

**When to load:** Adding or reviewing any route handler that mutates data, touching `packages/auth/`, adding a new secret-bearing service, or when asked whether the platform is "secure" beyond RLS tenant isolation (skill 5) and SAST (skill 11) — this skill covers what those two do not.

---

## The rule

> Tenant isolation answers "can tenant A see tenant B's data" (no). It does not answer "can any authenticated user of tenant A do anything any other user of tenant A can do" — that is a *role/permission* question, answered by a completely different, much less consistently-enforced layer.

## 1. The authz-within-tenant gap — a designed system that mostly isn't used

`.claude/skills/03-rbac-policy-language.md` documents a real, centralized `policy-service` DSL (`POST /policy/evaluate`, conditions like `owner_only`/`status_in`/`amount_max`, delegation, break-glass, Redis-cached decisions, an audit event on every decision) — and `packages/auth/src/permissions.ts` implements the client side of it (`checkPermission`/`requirePermission`). **In practice, only 5 files in the entire repo call `requirePermission(`** (hrms/payroll/workflow-service's `shared/context.ts`, plugin-service's sandbox runtime, and the helper itself).

What almost every route actually uses instead is a **locally-defined, copy-pasted `requireRole(ctx, roles: string[])`** — a bare array-membership check with no conditions, no caching, and no `policy.decision` audit trail — independently redefined in `src/shared/context.ts` in 30+ different services. There are at least **four different names** for this same shape of check in the wild: `requireRole`, `requireSuperAdmin`, `assertOwnership`, `requirePermissionKey`. **A review or scanner that only greps for one of these names will produce false negatives on the others** — the exact "scanner blind spot from a differently-named helper" lesson skill 16 documents for its own transaction-safety scanner, just in the authz layer instead.

**How to find a missing check:** for any mutating route (`POST`/`PATCH`/`PUT`/`DELETE`), confirm the handler itself — not a sibling in the same file, not the route registration wrapper — calls one of the four helpers above before touching the database. A real, currently-unfixed example: `services/hrms-service/src/modules/social/routes.ts`'s `POST /v1/hrms/announcements` is doc-commented `(HR admin only)` but calls no authz helper at all, while its siblings in the same file (`travel-requests/:id/approve`, `expenses/:id/approve`) correctly call `requireRole(ctx, [...])` — any authenticated employee of any role can currently post an org-wide announcement. This exact defect class (one handler in a file silently missing the check every sibling has) has recurred at least three times historically, including `POST /v1/helpdesk/csat`, self-described in its own fix commit as "the same defect class as today's hrms-service/id-cards fix."

**A silent permission regression is also a real recorded incident, not hypothetical**: `services/finance-service/src/modules/gl/routes.ts` carries a comment explaining that a role constant was narrowed from `FINANCE_ROLES` to `FINANCE_ADMIN_ROLES` "as a side effect of an unrelated diff — the commit message never mentions a role/permission change," so a normal finance officer could see the GL page but got a 403 on the one action it exists for. **Changing a shared role constant is a permissions change and must say so in the commit message, even when it's not the diff's main point.**

## 2. Dependency / CVE scanning — the CI job name is misleading

`.github/workflows/security.yml`'s **"Dependency Audit"** job does not scan for CVEs. It runs `scripts/ci/dependency-audit.mjs`, which checks lockfile presence, absence of `"*"`/`"latest"` ranges, that `@civitasone/*` packages use `workspace:*`, typosquat-name detection, and dependency count — supply-chain **hygiene**, not vulnerability scanning. The workflow's own comment is explicit about why: *"Prefer the repo's supply-chain hygiene script over raw `pnpm audit`, which currently fails on transitive Next/postcss advisories tracked separately for a Next 15 upgrade."* No `.snyk` file or audit-ignore list exists anywhere. **Real, known CVEs in transitive dependencies are not gated on by CI at all right now** — don't infer CVE-clean from a green "Dependency Audit" check.

Trivy container scanning exists but only covers 3 of ~50 service images (gateway/finance/hrms, chosen as "highest-exposure") and is explicitly non-blocking (`exit-code: '0'`, comment: *"do not hard-fail the PR gate until the runtime image is fully hardened"*). CodeQL SAST and gitleaks secret-scanning are real and do gate the build.

## 3. Rate limiting — a genuinely good pattern, worth preserving as-is

`services/gateway-service/src/app.ts` layers rate limits deliberately: a global cap (1000/min default), a **per-tenant** cap keyed on `x-tenant-id` (200/min default — comment: *"a shared counter is a denial-of-service weapon: one attacker burns the whole tenant's budget"*), and a **materially stricter** limit on `/api/identity/*` (10/min default) keyed by **username from the request body, not IP** — specifically to defeat distributed brute-force from many IPs against one account. Backed by Redis for fleet-wide enforcement with graceful in-process fallback if Redis is unreachable. When adding a new auth-adjacent or high-abuse-risk endpoint, follow this exact shape (per-identity key, not just per-IP) rather than relying on the global tier alone.

## 4. Secrets in transit and at rest

PII-at-rest encryption is real and reasonably mature: a shared `pii-crypto.ts` (present in crm/finance/hrms/notification/procurement/telephony/payroll/citizen/metadata/visitor/meeting/court-service) implements AES-256-GCM via a Drizzle custom type with a **versioned keyring** (`enc:v1:` and `enc:v2:<keyid>:` prefixes) so keys can rotate without breaking existing ciphertext, and fails closed in production if the salt is unset. A non-prod-only hardcoded fallback salt constant exists in source — acceptable given the prod fail-closed check, but grep for the same shape (`DEFAULT_*` fallback constant) before assuming a new service's crypto module is safe by inspection alone.

Two real, fixed hardcoded-secret-class bugs are worth knowing about before touching similar code: a fail-loud fix for `ID_CARD_QR_SECRET` silently falling back to a hardcoded value, and a case where QR verification never actually checked the HMAC signature at all — both in hrms-service's ID-card feature. **A secret used for signing/verification that isn't independently tested for "does an invalid signature actually get rejected" is not verified, however correct the code looks.**

## 5. Session/token lifecycle — a real, unaddressed gap

`packages/auth/src/index.ts` verifies JWTs statelessly and correctly (RS256/JWKS in production, `iss`/`aud` enforced, HS256 fallback hard-blocked outside non-prod). `identity-service` has a real session-revocation surface (`DELETE /identity/sessions/:id`, gated to session-owner or `SESSION_ADMIN` roles, with `status: "active"|"revoked"|"expired"` modeled in the DB). **These two pieces are not connected**: `packages/auth/src/plugin.ts`'s `authPlugin` — registered by every service to gate every request — verifies the JWT signature and expiry only; it never checks the token's `sid` claim against the sessions table or any revocation list. Revoking a session marks a database row, but every already-issued access token for that session **stays fully valid on every service until it naturally expires.** Treat "the user's session was revoked" and "the user's access token is rejected" as two different, currently-disconnected claims — don't assume one implies the other when reasoning about an incident or writing a fix that depends on immediate revocation.

## Forbidden patterns

- A new mutating route with no `requireRole`/`requirePermission`/`requireSuperAdmin`/`assertOwnership` call, when every sibling handler in the same file has one.
- Narrowing or changing a shared role/permission constant without saying so explicitly in the commit message, even when it's a side effect of an unrelated change.
- A signing/verification secret with no test asserting an invalid signature is actually rejected (not just that a valid one is accepted).
- Assuming `pnpm audit`/CVE-clean because the CI "Dependency Audit" job passed — it checks hygiene, not vulnerabilities.
- Treating a revoked session as equivalent to an invalidated access token — they are not connected in the current implementation.

## Known gaps — not covered by this skill

- **No CVE/SCA scanning gates the build** — `pnpm audit` is explicitly skipped repo-wide (§2); a real transitive-dependency CVE is not caught by any CI job today.
- **Revoked sessions do not invalidate already-issued access tokens** (§5) — a genuine architectural gap, not a code bug in one place; closing it needs either a revocation-list check in `authPlugin` or materially shorter access-token lifetimes.
- **No systematic authz-within-tenant scan exists** — the 65-candidate manual scan in this skill's own research needed per-handler human verification against 4 differently-named helpers; a durable version of that scanner (mirroring skill 16's `scan_nested_tx_v2.py`) does not exist yet.
- **Rate-limit thresholds are unverified at real production load** — see skill 21 (Performance/Load) for the broader absence of load testing; the numbers in §3 above are configured defaults, not load-tested limits.
