# CivitasOne Suite — SAST Security Review

**Report ID:** SAST-FINDINGS-2026-06
**Scope:** `civitasone-suite` monorepo — 33 services, 12 packages, `apps/web`, `apps/mobile`
**Rigor:** CERT-In / SOC 2 static review
**Method:** Manual SAST (source-traced), evidence-driven. Every finding cites `service · module · file:line` with a snippet. Where evidence is absent: `NOT VERIFIABLE FROM PROVIDED CODEBASE`.
**Confidence labels:** `Verified` (full code path read) · `Pattern-confirmed` (repo + query layer read, route exposure confirmed by signature) · `Likely` · `Not Verifiable`.

---

## 1. Executive Summary

CivitasOne has a **strong, deliberate security baseline**: RS256/Keycloak JWT with prod HS256 rejection and algorithm pinning, Drizzle-only parameterised queries, a whitelisted analytics query builder, AES-256-GCM field encryption for PII and MFA secrets, a fail-closed gateway that strips internal-trust headers, helmet/CORS/rate-limit controls, non-root containers, and CI secret-scanning + CodeQL + dependency audit. The CQRS-via-queue + per-tenant cache pattern is applied consistently across most services.

However, the review found a **systemic inconsistency in object-level (tenant) authorization**. Most services scope object reads/writes by `tenantId` correctly (finance bills/payments, hrms employees, grants, procurement vendors, projects), but **several services omit the tenant predicate at the repository layer and the post-load tenant guard at the query layer**, producing **confirmed cross-tenant BOLA/IDOR** on sensitive data (legal cases, bank balances, RBAC roles) for both reads and mutations. Separately, the central **policy-evaluation endpoint trusts a client-supplied `actor`** (roles + tenantId), enabling cross-tenant permission enumeration. Finally, the **database RLS backstop is defined but never wired** (the `app.tenant_id` session GUC it depends on is never set by application code), so tenant isolation rests solely on application-layer `WHERE tenant_id` clauses — which the BOLA findings show are not uniformly present.

| Metric | Value |
|---|---|
| **Security Posture Score (WSP, 0–100)** | **58 / 100** |
| **Code Security Quality (0–10)** | **7.5 / 10** |
| Services in scope / reviewed in depth | 33 / 14 |
| Packages reviewed | 12 (auth, db, schemas, cache focus) |
| Confirmed Critical / High / Medium / Low / Info | 0 / 2 / 3 / 1 / 2 |
| **Release-gate verdict** | **FAIL** (Conditional PASS achievable after SAST-001 + SAST-002 fixes) |

> Gate rule (prompt §Gate): *any confirmed High ⇒ block release.* Two confirmed Highs (SAST-001, SAST-002) are present.

---

## 2. Scope & Coverage

- **Entry points reviewed:** route files across finance, hrms, grant, procurement, project, legal, policy, identity, notification, analytics, admin, telephony, billing, contract, stock services.
- **Auth boundaries:** `packages/auth` (`index.ts`, `context.ts`, `plugin.ts`, `permissions.ts`), gateway header handling, per-service `shared/context.ts`.
- **Data layer:** `packages/db` (`pool.ts`, `index.ts`), 36 RLS migrations, representative `repo.ts`/`queries.ts`/`consumer.ts` per module.
- **Crypto:** `telephony/pii-crypto.ts`, `crm/pii-crypto.ts` (referenced), `identity/mfa-crypto.ts`.
- **Outbound:** notification SMS/push/WhatsApp adapters + `http-gateway.ts`; admin `health/operations.ts`.
- **Infra/CI:** root `Dockerfile`, `.github/workflows/security.yml`, root `package.json`, `packages/auth/package.json`.

Coverage is a **deep representative sample**, not 100% line coverage of all 33 services. Modules not opened are explicitly out of evidence and are not asserted clean.

---

## 3. Scan Topology (findings by service)

| Service | Modules sampled | Files reviewed | Crit | High | Med | Low | Info |
|---|---|---|---|---|---|---|---|
| legal-service | cases | 4 | 0 | 1 | 0 | 0 | 0 |
| finance-service | payments, treasury, budget | 6 | 0 | 1¹ | 0 | 0 | 0 |
| policy-service | evaluate, roles | 6 | 0 | 1 (+1¹) | 0 | 0 | 1 |
| hrms-service | employee, self-service, service-book | 5 | 0 | 0 | 1 | 0 | 0 |
| identity-service | mfa, devices, sync | 3 | 0 | 0 | 1² | 0 | 0 |
| packages/auth | jwt verify | 4 | 0 | 0 | 1 | 0 | 0 |
| packages/db + migrations | RLS | 3 | 0 | 0 | 1² | 0 | 0 |
| notification-service | adapters, smtp, channels | 8 | 0 | 0 | 0 | 1 | 0 |
| stock / contract / procurement | item, rate, auction | 6 | 0 | 1¹ | 0 | 0 | 0 |
| (all services) | dependency ranges | — | 0 | 0 | 0 | 0 | 1 |
| **Clean (no finding in sampled paths)** | grant, project, procurement-vendor, analytics, admin-health, telephony-crypto, gateway | — | — | — | — | — | — |

¹ Affected location of the single canonical finding **SAST-001** (counted once globally).
² Cross-cutting platform finding (SAST-003 RLS, SAST-004 JWT) attributed to one service row.

---

## 4. Confirmed Controls (baseline — verified, not re-flagged)

| Control | Evidence | Verdict |
|---|---|---|
| RS256/JWKS, issuer validated, prod HS256 rejection, no `alg:none` | `packages/auth/src/index.ts:90-115` (`resolveAlgorithm` throws on prod HS256; `jwt.verify(..., {algorithms:["RS256"], issuer})`) | Verified |
| Gateway strips internal-trust headers | `gateway-service/src/app.ts:27` `STRIP_HEADERS = ["x-internal","x-internal-secret","x-internal-caller","x-service-secret"]` | Verified |
| No mass-assignment via passthrough | zero `.passthrough()` in `services/**`; bodies are `schema.parse(req.body)` (zod strips unknown keys) | Verified |
| Parameterised analytics query builder (no raw SQL, mandatory tenant predicate) | `analytics-service/src/modules/registry/builder.ts:78-92` | Verified |
| PII + MFA crypto = AES-256-GCM, scrypt KDF, env-injected key, fail-closed | `telephony/src/shared/pii-crypto.ts`, `identity/src/shared/mfa-crypto.ts:33-44` | Verified |
| Command exec uses fixed args, no shell | `admin-service/src/modules/health/operations.ts:118` `execFileAsync("pm2",["jlist"])`; log sources filtered `/^[a-z0-9-]+$/i` | Verified |
| Outbound SMS/push/WhatsApp URLs are operator-config (fixed hosts), not tenant input | `notification/src/adapters/{sms,whatsapp,push}.ts` build `api.twilio.com` / `graph.facebook.com` / `fcm.googleapis.com` | Verified — SSRF not reachable |
| Non-root container, multi-stage, prod-only deps | root `Dockerfile` `USER node`, tini, pruned `node_modules` | Verified |
| CI: gitleaks + `pnpm audit` + CodeQL `security-and-quality` | `.github/workflows/security.yml` | Verified |
| Error handlers return generic `INTERNAL` (no stack trace to client) | every reviewed `setErrorHandler` returns `{code:"INTERNAL", message:"internal error"}`, logs `err` server-side | Verified |
| Self-service endpoints scope to `userRef === actorId` | `hrms/src/modules/self-service/routes.ts` (all 4 handlers) | Verified — no employee-level IDOR |

---

## 5. Findings

### SAST-001 — Cross-tenant object access (BOLA/IDOR): missing tenant predicate + missing post-load tenant guard
- **Severity:** High · **Confidence:** Verified (3 endpoints) / Pattern-confirmed (3 endpoints)
- **CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-284, CWE-862 (Missing Authorization on mutation path)
- **OWASP:** Web A01:2021 Broken Access Control · API1:2023 BOLA
- **CVSS 3.1 (read):** 6.5 `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N` · **(read+write, legal/policy):** 8.1 `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`

**Summary.** Several services namespace their per-tenant cache key by `tenantId` but then load the row by **primary key only**, with **no tenant column in the SQL** and **no `row.tenantId !== tenantId` rejection** after load. An authenticated user holding the route's role in tenant A can read — and on two paths mutate — another tenant's object by supplying its UUID.

**Root cause.** Inconsistent application of the house pattern. The safe modules add a post-load guard (e.g. finance `getBillDetail`/`getPayment`: `if (!row || row.tenantId !== tenantId) return null`). The affected modules omit it, and the underlying `findXById(id)` repo function has no `tenantId` argument.

**Evidence (canonical — legal cases read):**
`legal-service/src/modules/cases/queries.ts:5`
```ts
export async function getCase(id: string, tenantId: string): Promise<CaseRow | null> {
  return cache.getOrLoad<CaseRow>(
    cache.makeKey(tenantId, "case", id),
    () => repo.findCaseById(id),        // ← loads by id only
  );                                     // ← NO post-load tenantId check
}
```
`legal-service/src/modules/cases/repo.ts:7`
```ts
export async function findCaseById(id: string): Promise<CaseRow | null> {
  const rows = await db.select().from(legalCases).where(eq(legalCases.id, id)).limit(1);
  return rows[0] ?? null;               // ← no eq(legalCases.tenantId, ...)
}
```
Route is reachable by any `legal_officer|legal_admin|audit_officer` via gateway prefix `/api/v1/legal`:
`legal-service/src/modules/cases/routes.ts:29` `app.get("/v1/legal/cases/:id", ...)` → `queries.getCase(id, ctx.tenantId)`.

**Evidence (mutation — legal case dispose):** `legal-service/src/modules/cases/consumer.ts:43-55`
```ts
queue.subscribe(COMMANDS.caseDispose, async (msg) => {
  const p = msg.payload as { caseId: string; tenantId: string; disposition: string };
  ...
  const legalCase = await repo.findCaseByIdTx(tx, p.caseId);   // ← no tenant filter
  if (!legalCase) throw new Error(`case ${p.caseId} not found`);
  assertCanDispose(legalCase.status ?? "pending");
  await repo.updateCase(tx, p.caseId, { status: "disposed", ... }); // ← no tenant filter
```
Contrast the **correct** pattern in finance treasury (`finance-service/src/modules/treasury/consumer.ts`):
```ts
const dep = await repo.findDepositByIdForUpdateTx(tx, p.depositId);
if (!dep || dep.tenantId !== p.tenantId) throw new Error(`UNKNOWN_DEPOSIT...`);
```

**Affected locations**

| Repo | Module | File:Line | Endpoint / Function | Verdict |
|---|---|---|---|---|
| legal-service | cases | `queries.ts:5` + `repo.ts:7` | `GET /v1/legal/cases/:id` (read) | Verified — cross-tenant read |
| legal-service | cases | `consumer.ts:43` + `repo.ts:12,20` | `PATCH /v1/legal/cases/:id/dispose` (mutate) | Verified — cross-tenant write |
| finance-service | treasury | `queries.ts:6` + `repo.ts:11` (`findBankById(id)`) | `GET /v1/finance/banks/:id/balance` (read) | Verified — leaks account no. + balance |
| policy-service | roles | `queries.ts:7` + `repo.ts:13` (`findRoleById(id)`) | `GET /policy/roles/:id`, `GET /policy/roles/:id/permissions` | Verified — cross-tenant RBAC read |
| policy-service | roles | `consumer.ts:25-30` (`findRoleByIdTx`/`updateRole`, no tenant check) | `PATCH /policy/roles/:id` (mutate) | Verified — cross-tenant RBAC tamper |
| stock-service | item | `queries.ts:5` + `repo.ts:12` (`findItemById(id)`) | `GET /v1/stock/items/:id` | Pattern-confirmed |
| contract-service | rate | `queries.ts:8` + `repo.ts:7` (`findRcById(id)`) | `GET /v1/contract/rate-contracts/:id` | Pattern-confirmed |
| procurement-service | auction | `queries.ts:8` + `repo.ts:7` (`findAuctionById(id)`) | `GET /v1/procurement/auctions/:id` | Pattern-confirmed |
| notification-service | channels | `queries.ts:16` + `repo.ts:32` (`findChannelById(id)`) | `getChannel()` — **no by-id route currently registered** | Latent (unsafe repo, not exposed) |

> **Excluded (verified safe / not applicable):** `billing-service/plans` — `GET /v1/billing/plans/:id` is `config:{public:true}` and plans are a **platform-global** catalog (`tenant_id default PLATFORM`, cache key `billing:platform:plan`), so this is intentional, not cross-tenant.

**Exploitation path / PoC.** Authenticated user in tenant A (role `legal_officer`):
```
PATCH /api/v1/legal/cases/<tenant-B-case-uuid>/dispose
Authorization: Bearer <tenant-A token>
{ "disposition": "closed" }
```
→ tenant B's litigation case is marked `disposed`; audit row is written under tenant A's actor (attributable, but the write already executed). The read variant (`GET .../cases/:id`, `GET /finance/banks/:id/balance`, `GET /policy/roles/:id`) returns tenant B's case details, bank account number + balance, or role/permission set respectively. UUIDs are not trivially enumerable but leak via cross-references, audit exports, logs, and shared documents.

**Business + technical impact.** Cross-tenant disclosure of litigation records, bank account numbers/balances, and RBAC configuration; cross-tenant tampering of case disposition and role definitions. Directly breaks the multi-tenant isolation guarantee for the affected resources.

**Remediation (stack-specific).** Add the tenant predicate at the repo layer **and** a defensive post-load guard at the query layer; for mutations, verify ownership before write. Prefer putting the trusted value last is not enough — filter in SQL:
```ts
// repo.ts
export async function findCaseById(id: string, tenantId: string) {
  const rows = await db.select().from(legalCases)
    .where(and(eq(legalCases.id, id), eq(legalCases.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
// queries.ts
export async function getCase(id: string, tenantId: string) {
  const row = await cache.getOrLoad(cache.makeKey(tenantId, "case", id),
    () => repo.findCaseById(id, tenantId));
  return row && row.tenantId === tenantId ? row : null; // defence-in-depth
}
// consumer.ts (mutation)
const c = await repo.findCaseByIdTx(tx, p.caseId, p.tenantId);
if (!c || c.tenantId !== p.tenantId) throw new Error("UNKNOWN_CASE");
```
Then wire RLS (SAST-003) so the database refuses cross-tenant rows even if a future handler regresses.

**Post-patch verification.** Add a contract test per endpoint: tenant-A token + tenant-B uuid ⇒ 404. Grep gate: every `find*ById` in a `repo.ts` must take `tenantId`; every `getOrLoad` over a single-entity must post-check `tenantId`.

---

### SAST-002 — Policy evaluation trusts client-supplied `actor` (roles + cross-tenant tenantId) with no internal-only guard
- **Severity:** High · **Confidence:** Verified
- **CWE:** CWE-863 (Incorrect Authorization), CWE-639, CWE-602 (client-side trust of a server decision input)
- **OWASP:** Web A01:2021 · API5:2023 Broken Function-Level Authorization / API3
- **CVSS 3.1:** 7.1 `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`

**Summary.** `POST /v1/policy/evaluate` (the central authorization decision point) accepts an `actor` object in the request body containing `userId`, `tenantId`, and `roles[]`, and computes the decision from those client-supplied values. It is registered behind `authPlugin` (any valid end-user JWT is accepted) and is exposed through the gateway (`/api/v1/policy` and `/api/policy`). Nothing binds `body.actor` to the authenticated `ctx`, and there is no internal-only (x-internal/secret) restriction at the route.

**Evidence.** `policy-service/src/modules/evaluate/routes.ts:25-40`
```ts
const body = evaluateBody.parse(req.body);
const actor = body.actor ?? { userId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles };
const granted = await repo.findGrantedPermissions(actor.tenantId, actor.userId, actor.roles);
const result = evaluateDecision(body.permissionKey, actor.roles, granted);
```
`policy-service/src/modules/evaluate/domain.ts:28-31` — client roles short-circuit to allow with **no DB lookup**:
```ts
if (actorRoles.includes("super_admin")) {
  return { decision: "allow", reason: "role:super_admin", cacheable: true, ttlSeconds: 60 };
}
```
`policy-service/src/modules/evaluate/repo.ts:6-14` — the query runs against the **client-supplied** `tenantId`, and policy-service has **no RLS session scoping** (see SAST-003), so it reads another tenant's `roles`/`permissions`/`role_bindings`.
Exposure: `gateway-service/src/registry.ts:17-18` route `policy-v1 → /api/v1/policy`.

**Exploitation path / PoC.** Authenticated user in tenant A:
```
POST /api/v1/policy/evaluate
{ "permissionKey": "finance.bill.approve",
  "actor": { "userId": "<tenant-B-user>", "tenantId": "<tenant-B>", "roles": [] } }
```
→ response `reason: "role:<tenantB-role>+finance.bill..."` enumerates tenant B's RBAC grants. The `roles:["super_admin"]` variant returns `allow` for any key (inert against current consumers, which re-check server-side with the real token, but a decision-integrity foothold for any future caller that trusts the body actor).

**Impact.** Cross-tenant enumeration of role names and permission grants from the central policy store; latent privilege-escalation if any consumer ever trusts the decision for the body-supplied actor.

**Remediation.** (1) Restrict the route to internal callers only — require `x-internal` + `INTERNAL_SERVICE_SECRET` (gateway already strips these from clients, so end-user calls would be rejected). (2) Always derive the evaluated principal from `ctx`, never from `body.actor`; or assert `body.actor.tenantId === ctx.tenantId`. (3) Never grant on client-asserted roles — resolve roles from the binding store for the authenticated subject.
> **Related Info:** `packages/auth/src/permissions.ts:checkPermission` sends `x-internal:"1"` but **omits** `x-service-secret`; under the prod `authPlugin` that internal call would be rejected (fail-closed 503). Fix the internal-call contract together with this finding.

**Post-patch verification.** Contract test: end-user JWT to `/api/v1/policy/evaluate` ⇒ 401/403; cross-tenant `actor.tenantId` ⇒ no foreign rows returned.

---

### SAST-003 — RLS tenant-isolation backstop defined but never wired (`app.tenant_id` GUC never set)
- **Severity:** Medium · **Confidence:** Verified (absence of GUC-setting code) / `NOT VERIFIABLE` (live DB role attributes)
- **CWE:** CWE-1188 (insecure default — feature shipped unconfigured), CWE-668
- **OWASP:** A05:2021 Security Misconfiguration · A01 (defence-in-depth)

**Summary.** 36 migrations enable `FORCE ROW LEVEL SECURITY` with policies of the form `tenant_id = <schema>.current_tenant_id()`, where `current_tenant_id()` reads `current_setting('app.tenant_id', false)`. The `false` arg makes the lookup **throw if the GUC is unset**. The migration comments say *"SET LOCAL by middleware"* — but **no such middleware exists**: a full-repo search (excluding `node_modules`/`dist`) for `set_config` / `SET LOCAL` / `app.tenant_id` in application code returns **zero matches**, and `packages/db/src/pool.ts` opens the postgres-js client with no per-connection/per-transaction tenant GUC.

**Evidence.**
`finance-service/migrations/0019_rls_tenant_isolation.sql:5-12`
```sql
-- Helper function: reads app.tenant_id from session variable (SET LOCAL by middleware)
CREATE OR REPLACE FUNCTION budget.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT current_setting('app.tenant_id', false)::uuid $$;
```
`packages/db/src/pool.ts:13-29` — `postgres(url, {max, prepare, idle_timeout, connect_timeout})`; no `connection`/`onnotice`/`SET` hook.
Repo-wide: `grep -rn "set_config|SET LOCAL|app.tenant_id" --include=*.ts (excl node_modules,dist)` → **no matches**.

**Implication.** Two possibilities, both adverse: (a) if the service DB role is subject to RLS, every query on a FORCE-RLS table would error (`unrecognized configuration parameter "app.tenant_id"`) — yet the app functions, implying (b) the connecting role **bypasses RLS** (superuser/BYPASSRLS) or migrations are not applied at runtime, leaving RLS **inert**. Either way the database-level backstop the baseline claims is **not providing per-request tenant isolation**. Tenant isolation currently rests entirely on application `WHERE tenant_id` clauses — which SAST-001 shows are not uniformly present.

**Remediation.** Set the GUC per request/transaction from the trusted context, e.g. wrap the tenant-scoped `db.transaction` to first run `SELECT set_config('app.tenant_id', $1, true)` with `ctx.tenantId`; ensure service roles are **non-superuser, non-BYPASSRLS**; add a startup assertion that `current_setting('app.tenant_id', true)` is honoured. Add an integration test that a query without the GUC set is rejected.
> The exact runtime DB role privileges are **NOT VERIFIABLE FROM PROVIDED CODEBASE** (no `infra/db` grants file was located in scope).

---

### SAST-004 — JWT `audience` not validated on the RS256 production path
- **Severity:** Medium · **Confidence:** Verified
- **CWE:** CWE-287, CWE-1390 (incorrect token validation) · **OWASP:** A07:2021 / API2:2023
- **CVSS 3.1:** 4.2 `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`

**Summary.** The production verifier pins algorithm and validates `issuer` but **not `audience`**. The dev/test HS256 path *does* validate `aud` (`verifyToken`), so the prod path is weaker than the test path.

**Evidence.** `packages/auth/src/index.ts:117-124`
```ts
return jwt.verify(token, publicKey, {
  algorithms: ["RS256"],
  issuer: `${keycloakUrl}/realms/${realm}`,   // ← no `audience:` option
}) as CivitasJwtPayload;
```
vs `index.ts:130-138` (`verifyToken`) which sets `{ algorithms:["HS256"], issuer, audience }`.

**Impact.** A token minted by the same Keycloak realm for a **different client/audience** (e.g. a low-privilege public-facing client) would be accepted by backend services. Exploitability depends on the realm having multiple clients/audiences (`NOT VERIFIABLE` from code), hence Medium.

**Remediation.** Add `audience: process.env.JWT_AUDIENCE` (e.g. the API client id) to the RS256 `jwt.verify` options and fail closed if unset in production. Add a unit test rejecting a valid-signature token with a wrong `aud`.

---

### SAST-005 — Stored XSS / HTML injection in HRMS service-book PDF endpoint
- **Severity:** Medium · **Confidence:** Verified
- **CWE:** CWE-79 (Improper Neutralization of Input During Web Page Generation) · **OWASP:** A03:2021 Injection
- **CVSS 3.1:** 5.4 `AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:L/A:N`

**Summary.** The service-book HTML is built by interpolating database row fields straight into markup and served as `text/html`, with no output encoding. The `employeeId` is UUID-validated (safe), but `entryType`, `description`, and `documentRef` are not escaped.

**Evidence.** `hrms-service/src/modules/service-book/pdf-routes.ts:39-46`
```ts
const entryRows = rows.map((e) =>
  `<tr><td>${e.effectiveDate}</td><td>${e.entryType}</td><td>${e.description}</td><td>${e.documentRef ?? "—"}</td></tr>`
).join("");
const html = renderTemplate(SERVICE_BOOK_TEMPLATE, { employeeId: id, entryRows });
return reply.header("content-type", "text/html; charset=utf-8").send(html);
```

**Exploitation path.** A service-book entry whose `description` contains `<script>…</script>` (or `<img onerror>`) is stored, then executes in the browser of any HR user who opens the rendered service book. Stored XSS in an authenticated HR context (session/CSRF token theft, actions as the viewer).

**Remediation.** HTML-encode all interpolated values (`&`,`<`,`>`,`"`,`'`), or render via a templating engine with auto-escaping, or serve as a real PDF (server-side render) rather than `text/html`. Add a CSP for this response.

---

### SAST-006 — Recipient PII and SMTP user written to stdout via `console.log`
- **Severity:** Low · **Confidence:** Verified
- **CWE:** CWE-532 (Insertion of Sensitive Information into Log File), CWE-200 · **OWASP:** A09:2021

**Evidence.** `notification-service/src/modules/email/smtp-sender.ts:28`
```ts
console.log(`[EMAIL] Sending to: ${to} | Subject: ${subject} | via ${host}:${port} user=${user ?? "anonymous"}`);
```
This logs the **recipient email address (PII)**, subject, and **SMTP username** to stdout, bypassing the structured pino logger's redaction (the operations log redactor `redactLogLine` only protects log-tail reads, not this direct write).

**Impact.** PII/credential-context leakage to container stdout / centralized logs; DPDP exposure.

**Remediation.** Use the service's pino logger with field redaction; mask the recipient (`maskRecipient`, already used by the SMS/push adapters) and drop the SMTP user from logs. Remove/guard the dry-run `console.log` at line 19 behind a debug flag.

---

### SAST-007 — Mass-assignment latent risk: trusted fields placed before `...body` spread
- **Severity:** Low (Info-leaning) · **Confidence:** Verified not-currently-exploitable
- **CWE:** CWE-915 (Improperly Controlled Modification of Object Attributes)

**Summary.** The pervasive command pattern is `payload: { id, tenantId: ctx.tenantId, ...body }` — the **validated** body spread comes **after** the trusted `id`/`tenantId`. If a future schema declared an `id`/`tenantId` field (or used `.passthrough()`), the spread would override the trusted values. Today this is **not exploitable**: zod strips unknown keys by default (no `.passthrough()` exists anywhere), and consumers re-map known fields explicitly. The identity sync write-through already demonstrates the correct defensive ordering: `payload: { ...m.payload, id: m.entityId, tenantId: ctx.tenantId }` (`identity-service/src/modules/sync/routes.ts`).

**Evidence.** e.g. `finance-service/src/modules/payments/commands.ts:17`, `hrms-service/src/modules/employee/commands.ts:15`, `legal-service/.../commands.ts` — all `{ id, tenantId: ctx.tenantId, ...body }`.

**Remediation.** Adopt the spread-first ordering (`{ ...body, id, tenantId: ctx.tenantId }`) repo-wide and keep `.strict()` on command bodies so the invariant cannot silently break.

---

### SAST-008 — Caret version ranges on security-critical dependencies
- **Severity:** Info · **Confidence:** Verified (mitigated)
- **CWE:** CWE-1104 (Use of Unmaintained/Unpinned Components — informational)

**Evidence.** `packages/auth/package.json`: `jsonwebtoken ^9.0.0`, `jwks-rsa ^3.1.0`, `fastify ^4.28.0` (dev/peer). These are caret ranges, but the monorepo commits `pnpm-lock.yaml`, CI installs with `--frozen-lockfile`, and `security.yml` runs `pnpm audit --prod --audit-level=moderate` + CodeQL weekly and on PR. `jsonwebtoken@9` is the post-2022-CVE major. `jose` was **not found** in scope (`NOT VERIFIABLE` — no `jose` dependency observed). Net posture: acceptable.

**Remediation.** Optional hardening: pin exact versions for `jsonwebtoken`/`jwks-rsa`, add Trivy/Semgrep, and gate `pnpm audit` at `high` for `--prod`.

---

## 6. Authorization & Trust-Boundary Review

- **Function-level authZ (RBAC):** Sampled all `app.post/patch/delete` handlers; every mutation reviewed calls `requireRole` (local role check), `requireSuperAdmin`, or an ABAC helper. The three files flagged by an automated guard as "no `requireRole`" were verified: `identity/devices` (self-scoped to `ctx.actorId`), `identity/sync` (uses `authorizeMailbox` ABAC + `assertTrustedDevice`), and `policy/evaluate` (the design flaw is SAST-002, not a missing role check). **No mutation route is unauthenticated.**
- **Object-level authZ (BOLA):** Inconsistent — see SAST-001.
- **Tenant isolation:** Application-layer scoping is the *only* live layer (RLS inert, SAST-003) and is not uniform (SAST-001).
- **Internal trust boundary:** Gateway strips `x-internal*`/`x-service-secret` (strong). `authPlugin` fails closed at startup if `INTERNAL_SERVICE_SECRET` is unset in prod. One internal-call contract inconsistency noted under SAST-002.

## 7. API Security, Secrets, Supply-Chain, Business Logic

- **Input validation:** zod at every reviewed boundary; unknown keys stripped. Good.
- **SSRF:** Not reachable — outbound URLs are operator-config fixed hosts. (`http-gateway.ts` `fetch(req.url)` is only fed provider URLs.) If a tenant-controllable webhook channel is ever added, enforce an allowlist + block private/link-local ranges per skill §B.
- **Secrets:** None hardcoded (CI gitleaks + manual confirm). Crypto keys env-injected, fail-closed.
- **Supply chain:** Lockfile committed, frozen installs, weekly audit + CodeQL. SAST-008 only.
- **Business logic:** Finance treasury deposit disposition uses `FOR UPDATE` + guarded balance UPDATE (no double-spend) — exemplary. Grant disbursement uses SQL aggregates with tenant scoping. Idempotency via `markProcessed`/idempotency keys throughout.

---

## 8. Security Score — WSP (Weighted Severity Penalty) model

**Model.** `Score = 100 − Σ(weightₛ × adjustment)` where severity weights are Critical 25 · High 12 · Medium 6 · Low 2 · Info 0.5, and `adjustment` reflects confidence × exploitability × breadth (Confirmed+exploitable = 1.0; partly-inert/needs-precondition = 0.7–0.85; defence-in-depth/mitigated = 0.5; systemic breadth surcharge up to ×1.25).

| Finding | Severity | Base | Adjustment | Penalty |
|---|---|---|---|---|
| SAST-001 cross-tenant BOLA (6 endpoints, read+write) | High | 12 | ×1.25 (breadth) | 15.0 |
| SAST-002 policy actor trust | High | 12 | ×0.85 (partly inert) | 10.2 |
| SAST-003 RLS not wired | Medium | 6 | ×0.80 (defence-in-depth) | 4.8 |
| SAST-004 JWT aud not checked | Medium | 6 | ×0.80 (precondition) | 4.8 |
| SAST-005 service-book XSS | Medium | 6 | ×0.70 (UI+insert needed) | 4.2 |
| SAST-006 PII in console.log | Low | 2 | ×1.00 | 2.0 |
| SAST-007 mass-assign ordering | Low | 2 | ×0.50 (latent) | 1.0 |
| SAST-008 dep ranges | Info | 0.5 | ×0.50 (mitigated) | 0.5 |
| **Total penalty** | | | | **42.5** |

**Security Posture Score = 100 − 42.5 = 57.5 ≈ 58 / 100.**
**Code Security Quality = 7.5 / 10** (strong, consistent patterns and crypto; downgraded for per-service authZ inconsistency and the unwired RLS backstop).

---

## 9. What an attacker can do today

Given **one valid end-user account in any tenant**, through the public gateway:
1. **Read another tenant's litigation cases** (`GET /api/v1/legal/cases/:id`) with a known case UUID — petitioner, court, subject, counsel.
2. **Read another tenant's bank account number + balance** (`GET /api/v1/finance/banks/:id/balance`).
3. **Close (dispose) another tenant's legal case** (`PATCH /api/v1/legal/cases/:id/dispose`) and **tamper with another tenant's RBAC roles** (`PATCH /policy/roles/:id`).
4. **Enumerate another tenant's role/permission configuration** via `POST /api/v1/policy/evaluate` with a forged `actor.tenantId`.
5. **Store XSS** in an employee service book that fires in any HR reviewer's browser.

What they **cannot** do (controls hold): forge tokens (RS256/JWKS, no `alg:none`, prod HS256 rejected), inject SQL (Drizzle + whitelisted analytics builder), spoof internal-service identity (gateway strips trust headers), read hardcoded secrets (none), reach another service's database directly (per-service DB logins — though `infra/db` grants were `NOT VERIFIABLE` in scope), or SSRF the notification gateway.

---

## 10. Final Verdict

### 🔴 FAIL (release gate) — Conditional PASS achievable after the two High fixes

Per the gate rule, the two **confirmed High** findings (SAST-001 cross-tenant BOLA, SAST-002 policy-actor trust) block release. The surrounding architecture is strong and the fixes are well-scoped.

**Minimum actions before production (in order):**
1. **SAST-001** — Add `tenantId` to every single-entity `find*ById` repo function and a post-load `row.tenantId === tenantId` guard in the query layer; add ownership checks in the legal `caseDispose` and policy `updateRole` consumers. Remediate all 6 confirmed/pattern-confirmed endpoints + the latent channels repo. Add per-endpoint cross-tenant contract tests.
2. **SAST-002** — Lock `/v1/policy/evaluate` to internal callers (x-internal + secret) and derive the principal from `ctx`, never `body.actor`; fix the `checkPermission` internal-secret omission.
3. **SAST-003** — Wire the `app.tenant_id` GUC per tenant-scoped transaction and confirm service DB roles are non-BYPASSRLS, so RLS becomes a real backstop behind the application checks.
4. **SAST-004 / SAST-005** — Validate JWT `audience` in the RS256 path; output-encode the service-book HTML.
5. **SAST-006 / SAST-007 / SAST-008** — Move SMTP logging to redacted pino; flip spread ordering + `.strict()` on command bodies; optionally pin crypto-critical deps.

**Re-test:** re-run this review on the diff; the posture score must rise above 80 and show **0 Critical/High** before flipping the gate to PASS.

---
*Generated by manual source-traced SAST. Conclusions are labelled Verified / Pattern-confirmed / Not Verifiable; no CVEs, versions, or controls were assumed without code evidence.*
