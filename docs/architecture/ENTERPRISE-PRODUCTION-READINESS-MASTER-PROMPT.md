# Enterprise Production Readiness Master Prompt
## CivitasOne Suite — Google/Microsoft/Apple-Grade Release Gate

> **Purpose:** This is the definitive checklist and execution prompt for making any CivitasOne microservice production-ready at an enterprise standard. Every service MUST pass ALL gates before being declared "shipped."

---

## Philosophy

Enterprise companies don't just check "tests pass." They verify:
1. **Correctness** — Does it do what the spec says? Every business rule tested.
2. **Security** — Can an attacker break it? Pen-test thinking on every endpoint.
3. **Resilience** — What happens when things fail? Graceful degradation proven.
4. **Observability** — Can we debug it at 3am without access to the code? Logs, traces, metrics.
5. **Data Integrity** — Can money disappear? Can rows leak between tenants? Proven impossible.
6. **UX Completeness** — Can a user get stuck? Every button, form, and flow works end-to-end.
7. **Performance** — Does it meet SLA under load? No N+1, no unbounded queries.
8. **Compliance** — Does it satisfy DPDP, CERT-In, GFR, GIGW? Proven by design.

---

## GATE 1: Static Analysis (Automated, Zero-Tolerance)

| Check | Command | Pass Criteria |
|-------|---------|---------------|
| TypeScript strict | `pnpm --filter @civitasone/{service} exec tsc --noEmit` | 0 errors |
| ESLint | `pnpm --filter @civitasone/{service} lint` | 0 errors (warnings OK) |
| RLS Scanner | `node scripts/ops/scan-bare-rls-writes.mjs \| grep {service}` | 0 findings |
| Dependency audit | `pnpm audit --filter @civitasone/{service}` | 0 critical/high |
| Secret scan | `grep -r "password\|secret\|apikey" services/{service}/src/ --include="*.ts" \| grep -v "process.env\|test_secret\|env\."` | 0 hardcoded secrets |

---

## GATE 2: Security Posture (Manual Review + Automated)

### 2.1 Authentication & Authorization
- [ ] Every route has `resolveContext(req)` + `requireRole(ctx, [...])` — no unprotected endpoints
- [ ] Role arrays are restrictive (not `["*"]` or overly broad)
- [ ] Admin-only mutations require `["super_admin"]` or service-specific admin role
- [ ] `GET` endpoints allow reader roles; `POST/PATCH/DELETE` require writer roles

### 2.2 Tenant Isolation (RLS)
- [ ] `FORCE ROW LEVEL SECURITY` enabled on ALL service tables (check migration)
- [ ] Every `db.select/insert/update/delete` is inside `db.transaction()` or `scopedRead()` (GUC enforcement)
- [ ] Cross-tenant test exists: Tenant B cannot see/modify Tenant A's data (test for EACH main entity)
- [ ] Platform-wide reads (e.g., admin dashboards) use `scopedPlatformRead` with explicit bypass migration

### 2.3 PII Encryption (DPDP Act 2023)
- [ ] `encryptedText()` used for: `pan`, `aadhaar`, `email`, `phone`, `bankAccount`, `ifsc`
- [ ] PII NEVER appears in log output (grep `pino` calls for field names)
- [ ] PII columns identified in schema with `@pii` comment or naming convention

### 2.4 Input Validation
- [ ] Every `POST/PATCH` body parsed through `zod` schema BEFORE any logic
- [ ] UUID params validated (`z.string().uuid()`)
- [ ] Query params validated with bounds (`limit` max 200, `offset` >= 0)
- [ ] No raw SQL string concatenation — only Drizzle parameterized `sql` tagged templates

### 2.5 Injection & SSRF
- [ ] No `eval()`, `new Function()`, or dynamic `import()` with user input
- [ ] Webhook/callback URLs validated (http/https only, no private IPs)
- [ ] File upload MIME types validated server-side (not just extension)
- [ ] CSV/export outputs escape formula-injection characters (`=`, `+`, `-`, `@`)

---

## GATE 3: Data Integrity & Domain Logic (Critical)

### 3.1 CQRS Compliance
- [ ] ALL write paths go through: Route → zod validate → `queue.publish(command)` → 202
- [ ] Consumer → `markProcessed(tx, msg.messageId)` → business logic → `enqueue(tx, event)` → `cache.invalidate`
- [ ] NO direct `db.insert/update/delete` in route handlers (except master-data CRUD which is explicitly documented)
- [ ] Every consumer emits an `audit.event.record` event

### 3.2 Idempotency
- [ ] Every consumer starts with `if (!(await markProcessed(tx, msg.messageId))) return;`
- [ ] Duplicate message test exists for each consumer (send same messageId twice → no double-write)

### 3.3 Optimistic Locking
- [ ] Mutable entities have `version int` column
- [ ] UPDATE queries include `WHERE version = $current`
- [ ] Concurrent write returns 409 Conflict (test exists)

### 3.4 Money as BigInt
- [ ] All monetary values stored as `bigint` (paise/cents)
- [ ] No `Number()` on aggregate monetary values (overflow at 2^53)
- [ ] Arithmetic uses `BigInt()` exclusively
- [ ] Test exists: `bigint-precision.test.ts` or equivalent

### 3.5 State Machines
- [ ] Every entity with a `status` column has an explicit transition map in `domain.ts`
- [ ] `assertStatusTransition(from, to)` function exists and is called before every update
- [ ] Invalid transition test exists (returns 409, not 500)
- [ ] Terminal states cannot be re-entered

### 3.6 Maker-Checker (Separation of Duties)
- [ ] Financial mutations (sanctions, payments, approvals) enforce `createdBy !== approvedBy`
- [ ] `assertDistinctMakerChecker()` domain function exists
- [ ] Self-approval test exists (same actor creates and approves → rejected)

---

## GATE 4: Error Handling & Resilience

### 4.1 Error Response Standards
- [ ] Every route module has `app.setErrorHandler(...)` or uses shared error handler
- [ ] `ZodError` → 400 with `fieldErrors` array
- [ ] `HttpError` → correct HTTP status + `{ code, message, correlationId }`
- [ ] Unknown errors → 500 with generic message (NO stack trace, NO pg error details)
- [ ] `correlationId` present on every error response

### 4.2 Circuit Breaker (External Calls)
- [ ] PFMS, Razorpay, DigiLocker, eSign providers use `@civitasone/circuit-breaker`
- [ ] Timeout enforced on all outbound HTTP (default 10s)
- [ ] Retry with exponential backoff (max 3, no retry on 4xx)

### 4.3 Graceful Degradation
- [ ] Cache miss falls through to DB (never returns 500 for cache failure)
- [ ] Queue unavailable → message not lost (outbox pattern guarantees delivery)
- [ ] External service down → 502/503 with clear message (not 500 with stack)

### 4.4 Shutdown & Draining
- [ ] `SIGTERM` handler: drain in-flight requests, stop consumers, close DB pool, then exit
- [ ] Worker has `process.on("SIGTERM", shutdown)` + `process.on("SIGINT", shutdown)`

---

## GATE 5: Test Coverage (Quantitative + Qualitative)

### 5.1 Quantitative Thresholds
| Metric | Minimum |
|--------|---------|
| Line coverage | ≥ 80% |
| Function coverage | ≥ 75% |
| Branch coverage | ≥ 65% |
| Tests passing | 100% (0 failures) |
| Test stability | Same result across 2 consecutive runs |

### 5.2 Qualitative Coverage (Must Have Tests For)
- [ ] **Happy path** for every consumer (message → DB write → event emitted)
- [ ] **Idempotency** for every consumer (duplicate messageId → no duplicate row)
- [ ] **Validation** for every POST route (malformed body → 400)
- [ ] **Auth** for every route (no token → 401, wrong role → 403)
- [ ] **Not found** for every GET/:id route (unknown UUID → 404)
- [ ] **State machine** transitions (valid + invalid for each entity)
- [ ] **Domain logic** pure functions (all branches, edge cases)
- [ ] **Cross-tenant isolation** (at least 1 test proving Tenant B can't read Tenant A)
- [ ] **Maker-checker** (self-approval rejected)
- [ ] **Concurrent write** (optimistic locking conflict → 409)

---

## GATE 6: Observability & Operational Readiness

### 6.1 Logging
- [ ] Pino structured JSON logger (not `console.log`)
- [ ] Every request logged: `correlationId`, `tenantId`, `userId`, `method`, `route`, `responseTime`, `statusCode`
- [ ] Every consumer logged: `messageId`, `topic`, `tenantId`, `processingTimeMs`, `outcome`
- [ ] NO PII in logs (check for email, phone, aadhaar, pan, bankAccount in log statements)
- [ ] Error logs include stack trace; INFO logs do not

### 6.2 Health & Metrics
- [ ] `GET /health` returns `{ status: "ok" }` with DB + cache + queue ping checks
- [ ] Service exports `/metrics` or OpenTelemetry spans
- [ ] Worker has outbox relay + partition maintenance

### 6.3 Operational Hooks
- [ ] DLQ handler registered for failed messages (3x retry → DLQ)
- [ ] Outbox purge scheduled (remove published messages > 7 days)
- [ ] Outbox relay running (poll unpublished → publish → mark)

---

## GATE 7: Frontend UX Completeness (Per Module)

### 7.1 Page Audit
- [ ] Every `page.tsx` is API-backed (calls a loader from `_data/loaders.ts`)
- [ ] No placeholder pages ("Coming Soon" or hardcoded arrays)
- [ ] Every `<button>` has an `onClick` or is a `<Link>`
- [ ] Every form has a submit handler connected to an API endpoint
- [ ] Every list page uses `DataTable` with: sortable, filterable, exportable, pageSize
- [ ] Every list page shows `StatGrid` at the top with meaningful metrics

### 7.2 Loading & Error States
- [ ] Every section has `loading.tsx` (skeleton animation) or inherits from parent
- [ ] Every section has `error.tsx` (error boundary with retry) or inherits from parent
- [ ] Empty states show contextual message + optional CTA

### 7.3 Accessibility
- [ ] Keyboard navigation works on all interactive elements
- [ ] `aria-label` or visible label on every control
- [ ] `role="status" aria-live="polite"` on cache/offline notices
- [ ] Color contrast meets WCAG 2.2 AA

### 7.4 Offline Capability
- [ ] `useSeededResource` used on all list pages (cache-first rendering)
- [ ] `DataSourceBadge` shown when data is from cache

---

## GATE 8: Integration & Cross-Service Contracts

### 8.1 Event Publishing
- [ ] Every COMMAND in `topics.ts` has a registered consumer in `worker.ts`
- [ ] Every EVENT emitted has at least one documented downstream consumer
- [ ] Event payload shapes are stable (no breaking changes without versioning)

### 8.2 Consumed Events
- [ ] Every `CONSUMED_EVENTS` entry has a registered consumer
- [ ] Consumer handles missing/optional fields gracefully (no crash on null)
- [ ] Consumer test proves the handler runs end-to-end with a realistic payload

### 8.3 API Contracts
- [ ] Response shapes match `@civitasone/schemas/web` DTOs
- [ ] `sendValidated(reply, Schema, data)` used for typed responses
- [ ] Pagination envelope: `{ data: T[], meta: { page, pageSize, total } }` or `{ data, pagination: { hasMore, pageSize } }`

---

## GATE 9: Migration & Schema Hygiene

- [ ] All migrations are additive and idempotent (`IF NOT EXISTS`, `IF EXISTS`)
- [ ] No `DROP COLUMN` without explicit approval
- [ ] `SET lock_timeout = '5s'` before any `ALTER TABLE`
- [ ] `CREATE INDEX CONCURRENTLY` (not blocking)
- [ ] Every migration has a rollback comment at the top
- [ ] No duplicate migration sequence numbers
- [ ] All `timestamptz` (never `timestamp without time zone`)
- [ ] Standard entity columns present: `id`, `tenant_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `version`

---

## GATE 10: Performance & Scalability

- [ ] No N+1 queries (no `SELECT` inside a loop — use batch `WHERE id IN (...)`)
- [ ] All list queries have `LIMIT` (no unbounded SELECTs)
- [ ] Max page size = 200 (enforced by zod validator)
- [ ] Redis cache used for hot reads (`cache.getOrLoad` pattern)
- [ ] Cache TTL: 5 min default, 60s for hot paths, invalidate on write
- [ ] Connection pooling: 20 connections per service (via `DATABASE_POOL_SIZE`)
- [ ] BigInt money: no `Number()` precision loss on values > 2^53

---

## Execution Flow (Per Service)

```
1. Run Gate 1 (automated) → fix all blockers
2. Run Gate 2 (security review) → fix PII, auth gaps, RLS issues
3. Run Gate 3 (data integrity) → fix CQRS bypasses, add missing idempotency
4. Run Gate 4 (error handling) → add missing handlers, circuit breakers
5. Run Gate 5 (test coverage) → write tests until all thresholds met
6. Run Gate 6 (observability) → verify health, logging, DLQ
7. Run Gate 7 (frontend UX) → fix dead buttons, add missing loaders
8. Run Gate 8 (integration) → verify all events have consumers
9. Run Gate 9 (migrations) → fix duplicates, add missing columns
10. Run Gate 10 (performance) → fix N+1, add limits, verify cache
```

---

## Scoring Rubric

| Score | Meaning |
|-------|---------|
| 10/10 | ALL 10 gates pass. Zero exceptions. Ship it. |
| 9/10 | 1 gate has a documented, non-blocking exception (e.g., PFMS stub) |
| 8/10 | 1 gate has a P1 issue (e.g., PII not encrypted, coverage < 80%) |
| 7/10 | Multiple P1 issues or 1 P0 (e.g., cross-tenant data leak) |
| ≤ 6/10 | Critical security or data integrity failures. DO NOT SHIP. |

---

## How to Use This Prompt

For each service:
```
Apply the Enterprise Production Readiness Master Prompt to {service-name}.
Run all 10 gates. Fix every finding. 
Do not declare "done" until every checkbox passes.
Commit with a detailed message listing what was fixed per gate.
Push to main.
```

---

*This prompt is the single source of truth for production readiness across all 38 CivitasOne microservices. No shortcuts. No "we'll fix it later." If a gate fails, the service is not shipped.*
