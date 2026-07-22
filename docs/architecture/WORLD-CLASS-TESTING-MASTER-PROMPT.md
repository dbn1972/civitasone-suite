# CivitasOne Suite — World-Class Testing Master Prompt

**Purpose:** This document is a comprehensive testing mandate for CivitasOne Suite. It defines what "better than SAP/Oracle" means in testable, measurable terms across all four layers: Mobile, Web, API, and Database. Use this as the execution guide for any AI agent, QA team, or automation pipeline.

**Philosophy:** SAP and Oracle are enterprise-grade but notoriously slow, brittle at the edges, and hostile to end-users. CivitasOne's goal is enterprise reliability with consumer-grade UX. Testing must validate both.

---

## 1. Success Criteria (Exit Gates)

No release ships until ALL of these pass:

| Gate | Metric | Target |
|------|--------|--------|
| Unit coverage | Lines covered per service | ≥ 80% all 38 services |
| Cross-service integration | Event chain tests | 100% pass (0 failures) |
| Security isolation | RLS + IDOR + tenant bypass | 100% pass |
| Contract compliance | Screen↔Route mapping | 100% wired |
| API boundary | Every endpoint: 401 + 403 + 400 + 404 + happy path | All pass |
| Load | 1,000 TPS sustained, p95 < 200ms reads | Meets target |
| Mobile widget tests | All critical screens | ≥ 70% feature coverage |
| E2E journeys | Top 10 user journeys | All pass on staging |
| Accessibility | WCAG 2.2 AA | Zero Critical violations |
| Offline resilience | Write → kill network → restore → verify sync | 100% data preserved |

---

## 2. Layer 1: Database & Data Integrity

### 2.1 RLS Enforcement (Row-Level Security)

```
FOR each tenant-scoped table:
  1. Insert rows for Tenant A and Tenant B
  2. Set app.tenant_id GUC to Tenant A
  3. SELECT * → assert ONLY Tenant A rows returned
  4. Attempt UPDATE/DELETE on Tenant B row → assert 0 rows affected
  5. Remove GUC → assert SELECT returns 0 rows (fail-closed)
```

**Run:** `npx vitest run tests/security/cross-tenant-isolation.test.ts`

### 2.2 Migration Safety

```
FOR each migration file in services/*/migrations/:
  1. Assert file starts with 4-digit sequence number
  2. Assert contains IF NOT EXISTS / IF EXISTS (idempotent)
  3. Assert no DROP COLUMN / DROP TABLE without explicit approval comment
  4. Assert SET lock_timeout present before ALTER TABLE
  5. Assert all timestamps are `timestamptz` (never `timestamp without time zone`)
  6. Run migration TWICE on empty DB → must succeed both times (idempotency)
```

### 2.3 Double-Entry GL Integrity

```
FOR the finance-service GL:
  1. Post 1000 random journal entries (property-based test, fast-check)
  2. Assert: SUM(debit) == SUM(credit) for every entry (to the paise)
  3. Assert: Trial balance nets to zero after all postings
  4. Assert: No entry exists with debit XOR credit (both sides always present)
  5. Assert: Amount stored as bigint paise (never float, never overflow at 2^53)
```

### 2.4 Optimistic Locking

```
FOR each mutable entity with `version int` column:
  1. Read entity (version = N)
  2. Start two concurrent updates with version = N
  3. First update succeeds → version becomes N+1
  4. Second update fails with 409 Conflict (version mismatch)
  5. Assert no data corruption (entity reflects exactly one update)
```

### 2.5 Referential Integrity Under Failure

```
FOR transactional outbox pattern:
  1. Begin transaction: INSERT entity + INSERT outbox event
  2. KILL connection after INSERT entity but BEFORE COMMIT
  3. Assert: Neither entity NOR outbox event exists (atomic rollback)
  4. Retry: Both succeed atomically
```

---

## 3. Layer 2: API (38 Microservices)

### 3.1 Route Boundary Coverage (Every Endpoint)

```
FOR each route in each service:
  1. 401 — Request without Authorization header → 401
  2. 403 — Request with valid token but wrong role → 403
  3. 400 — Request with malformed body/params (zod rejects) → 400
  4. 404 — Request for non-existent resource → 404
  5. 409 — Concurrent modification (version mismatch) → 409
  6. 422 — Business rule violation → 422
  7. 202 — Valid command accepted → 202 with correlationId
  8. 200 — Valid read → 200 with { data: T } or { data: T[], meta: {...} }
```

**Run:** `pnpm test` (per-service Vitest)

### 3.2 Cross-Service Event Chains

```
FOR each producer→consumer hop:
  1. Publish the PRODUCER's event on a shared MemoryQueue
  2. Wire the REAL downstream consumer onto the same queue
  3. Assert the downstream service emits the expected NEXT event
  4. Assert correlationId propagates end-to-end
  5. Assert idempotency: publish the SAME event twice → only ONE downstream effect
  6. Assert DLQ: publish a malformed event → goes to dead-letter (no crash)
```

**Critical chains to validate:**
- Finance: `bill.create` → `procurement.three_way_match` → `payment.schedule` → `pfms.disburse`
- HR: `employee.onboard` → `payroll.register` → `finance.gl.post`
- Procurement: `grn.accepted` → `stock.receipt` → `finance.gl.post` (depreciation)
- Visitor: `visit_request.create` → `visit_request.approve` → `pass.generate` → `check_in.record`
- Workflow: `task.overdue` → `notification.send` + `escalation` + `audit.record`

**Run:** `npx vitest run tests/integration/`

### 3.3 Security Testing

```
1. IDOR: Request resource belonging to another user within same tenant → 404 (not 403)
2. Tenant bypass: Forge JWT with Tenant B's ID, request Tenant A resource → 0 rows
3. SQL injection: Send `'; DROP TABLE--` in every string field → zod rejects (400)
4. Rate limiting: Send 200 requests in 1 minute → 429 after 100
5. CORS: Request from unlisted origin → rejected
6. PII in logs: Search all log output for email/phone/aadhaar patterns → ZERO matches
7. Secret scan: Run `scripts/ci/secret-scanner.mjs` → ZERO findings
```

**Run:** `npx vitest run tests/security/`

### 3.4 Performance (k6 Load Tests)

```
Scenario 1 — Sustained Read Load:
  - 500 virtual users, 5 minutes
  - GET /v1/finance/bills (paginated)
  - Target: p95 < 200ms, 0% errors, 1000 req/s throughput

Scenario 2 — Write Burst:
  - 100 virtual users, 2 minutes
  - POST /v1/visitor/visit-requests (command → 202)
  - Target: p95 < 500ms, 0% errors

Scenario 3 — Mixed Realistic:
  - 80% reads, 20% writes, 1000 VUs, 10 minutes
  - Across all major endpoints
  - Target: p95 < 300ms reads, p95 < 1s writes, error rate < 0.1%

Scenario 4 — Spike:
  - Ramp from 100 to 2000 VUs in 30 seconds
  - Hold 2 minutes, ramp down
  - Target: No 5xx during ramp, graceful degradation, recovery within 10s

Scenario 5 — Endurance:
  - 200 VUs, 2 hours continuous
  - Monitor memory, connection pool, cache hit ratio
  - Target: No memory leak (RSS stable ±10%), no connection exhaustion
```

---

## 4. Layer 3: Web Application (Next.js, 347 Screens)

### 4.1 Screen Contract Compliance

```
FOR each screen in apps/web:
  1. Has a corresponding API route in gateway registry
  2. Data fetched via fetchJson() with telemetryKey
  3. Loading state: shows skeleton/shimmer (not blank)
  4. Error state: shows ErrorState component with retry
  5. Empty state: shows contextual message with icon
  6. DataTable is sortable, filterable, paginated (pageSize: 15), exportable
  7. Uses useSeededResource for offline-first rendering
  8. PageHeader has: title, subtitle, back nav
```

**Run:** `npx vitest run tests/contract/screens.contract.test.ts`

### 4.2 Accessibility (WCAG 2.2 AA)

```
FOR every page:
  1. All interactive elements have visible labels or aria-label
  2. Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text
  3. Focus order is logical (tab through the page)
  4. No content conveyed by color alone (colorblind-safe)
  5. All images have alt text (decorative images have alt="")
  6. Form errors are associated with their inputs (aria-describedby)
  7. Live regions (role="status", aria-live="polite") for dynamic content
  8. Skip navigation link present
  9. Page has exactly one <h1>
  10. Keyboard operable: every action achievable without mouse
```

**Tools:** axe-core (automated), manual keyboard test, VoiceOver/NVDA walkthrough

### 4.3 End-to-End User Journeys (Playwright)

```
Journey 1 — Finance Officer (Bill Processing):
  Login → Dashboard → Finance → Create Bill → Attach Documents →
  Submit for Approval → Approve (maker-checker) → Schedule Payment →
  Verify GL Entry Created → Verify Audit Trail

Journey 2 — HR Admin (Employee Onboarding):
  Login → HR → Add Employee → Assign Pay Group → Generate Offer Letter →
  Mark as Joined → Verify Payroll Registration → Verify First Payslip

Journey 3 — Procurement Officer (Purchase Cycle):
  Login → Create Indent → Approve Indent → Create PO → Receive GRN →
  Three-Way Match → Generate Bill → Verify Stock Updated

Journey 4 — Citizen (Service Request):
  Public Portal (no login) → File Grievance → Track with Reference Number →
  Receive SMS Notification on Status Change → View Resolution

Journey 5 — District Collector (Approvals):
  Login (mobile) → View Pending Approvals → Approve Bill (offline) →
  Go Online → Verify Sync → Verify Audit Trail Records Action

Journey 6 — Visitor (Self-Service):
  Receive SMS Link → Pre-register Visit → Host Approves →
  Show QR at Gate → Check-in Recorded → Check-out → Pass Expired

Journey 7 — eOffice (File Noting):
  Login → DAK Inbox → Receive DAK → Create File → Add Note →
  Forward to Approver → Approver Adds Note → Approve → Dispatch

Journey 8 — Payroll Run:
  Login → HR → Finalize Attendance → Payroll → Create Run →
  Compute Salaries (7th CPC) → Maker-Checker Approve → Disburse →
  Verify GL Entries → Verify Employee Payslip → Verify TDS/PF Deductions

Journey 9 — Multi-Tenant Isolation:
  Create Tenant A → Add Data → Create Tenant B → Add Data →
  Login as Tenant A → Assert ZERO visibility of Tenant B data →
  Login as Tenant B → Assert ZERO visibility of Tenant A data

Journey 10 — Disaster Recovery:
  Full system running → Kill primary DB → Verify failover →
  Verify all in-flight requests complete or retry →
  Verify zero data loss (compare pre/post row counts)
```

---

## 5. Layer 4: Mobile Application (Flutter, 34 Features)

### 5.1 Widget Test Coverage

```
FOR each feature screen:
  1. Renders without error (smoke test)
  2. Loading state shows SkeletonList or CircularProgressIndicator
  3. Error state shows retry button (tap → re-fetches)
  4. Empty state shows contextual icon + message
  5. Data state renders expected content correctly
  6. Pull-to-refresh triggers data reload
  7. Key elements have Semantics labels
  8. Touch targets ≥ 48dp
```

**Run:** `flutter test` (requires Flutter SDK)

### 5.2 Offline-First Verification

```
FOR each write-capable screen:
  1. Perform action while ONLINE → verify immediate sync
  2. Perform action while OFFLINE → verify queued to outbox
  3. Restore connectivity → verify outbox drains within 30s
  4. Verify local optimistic update reflected in UI immediately
  5. Verify no duplicate entries after sync (idempotency)
  6. Kill app mid-write → restart → verify outbox item not lost (SQLite durable)
```

### 5.3 Device Compatibility Matrix

```
| Device | OS | Screen | Priority |
|--------|-----|--------|----------|
| Samsung Galaxy A14 | Android 13 | 720x1600 | P0 (target user device) |
| Redmi Note 12 | Android 12 | 1080x2400 | P0 |
| iPhone SE 3rd gen | iOS 16 | 750x1334 | P1 |
| iPhone 15 | iOS 17 | 1179x2556 | P1 |
| Samsung Galaxy Tab A8 | Android 13 | 1200x1920 | P2 (tablet) |
| iPad 10th gen | iOS 17 | 2160x1620 | P2 |
| Pixel 4a | Android 14 | 1080x2340 | P1 (stock Android) |
```

### 5.4 Performance Benchmarks

```
| Metric | Target | Measurement |
|--------|--------|-------------|
| Cold start (first meaningful paint) | < 3s | Stopwatch from tap to dashboard |
| Hot start (resume from background) | < 500ms | Lifecycle callback to render |
| List scroll (60fps) | 0 janky frames | DevTools timeline |
| Memory (after 30 min usage) | < 200MB RSS | Flutter DevTools |
| APK size | < 30MB | Release build |
| Offline DB size (1000 synced entities) | < 5MB | SQLite file size |
| Sync round-trip (empty → server) | < 2s | Network trace |
| Battery drain (1h background sync) | < 3% | Android Battery Stats |
```

### 5.5 Accessibility (Mobile)

```
FOR every screen:
  1. TalkBack (Android) reads all elements in logical order
  2. VoiceOver (iOS) reads all elements in logical order
  3. Switch Access can reach every interactive element
  4. Font scale 200% → no text truncation or overflow
  5. Dark mode → all text readable, no invisible elements
  6. RTL layout (Hindi) → all elements correctly mirrored
```

---

## 6. Comparison: What Makes This Better Than SAP/Oracle

| Dimension | SAP/Oracle | CivitasOne Target |
|-----------|-----------|-------------------|
| Cold start time | 15-30s (Java/ABAP) | < 3s (mobile), < 1s (API) |
| Offline capability | None (always online) | Full offline with sync |
| Multi-tenant isolation | Schema-per-tenant (expensive) | RLS + GUC (single DB, proven isolation) |
| Deployment | Weeks (change management) | Hours (canary 10% → 100%) |
| Mobile | SAP Fiori (web wrapper) | Native Flutter (60fps, offline) |
| Accessibility | Partial WCAG | WCAG 2.2 AA + GIGW 3.0 |
| API design | RFC/BAPI (proprietary) | REST + OpenAPI + event-driven |
| Localization | Configurable but complex | Hindi + English, RTL-ready, ARB files |
| Error recovery | Manual DLQ replay | Auto-retry + DLQ + idempotent consumers |
| Data precision | BCD (ABAP) | bigint paise (zero floating-point risk) |
| Compliance | Configurable | DPDP Act + CERT-In + GFR 2017 built-in |
| Test automation | Low (manual regression) | 10K+ automated tests, 80%+ coverage |

---

## 7. Execution Commands (CI Pipeline)

```bash
# 1. Backend unit + integration (all 38 services)
pnpm test

# 2. Cross-service integration chains
npx vitest run tests/integration/

# 3. Security tests
npx vitest run tests/security/

# 4. Architecture guards
npx vitest run tests/architecture/

# 5. Contract tests (screen ↔ route mapping)
npx vitest run tests/contract/

# 6. Typecheck (strict mode)
pnpm typecheck

# 7. Lint
pnpm lint

# 8. Coverage check (per-service)
for svc in services/*/; do pnpm --filter @civitasone/$(basename $svc) exec vitest run --coverage; done

# 9. Mobile tests (requires Flutter SDK)
cd apps/mobile && flutter test --coverage

# 10. E2E (requires staging environment)
cd apps/web && npx playwright test

# 11. Load tests (requires staging + k6)
k6 run tests/load/sustained-reads.js
k6 run tests/load/write-burst.js
k6 run tests/load/mixed-realistic.js

# 12. Secret scanner
node scripts/ci/secret-scanner.mjs

# 13. Module dependency validation
npx vitest run packages/schemas/tests/module-resolver.test.ts

# Full CI gate (typecheck + lint + test + coverage ≥ 80%):
pnpm ci:check
```

---

## 8. Continuous Quality Monitoring (Post-Deploy)

```
| What to Monitor | Tool | Alert Threshold |
|----------------|------|-----------------|
| Error rate (5xx) | Grafana | > 1% WARN, > 5% PAGE |
| p95 latency | Grafana | > 500ms WARN, > 2s PAGE |
| Queue depth (SQS/RabbitMQ) | CloudWatch/Prometheus | > 1000 WARN, > 5000 PAGE |
| DLQ size | Grafana | > 0 WARN (immediate investigation) |
| Cache hit ratio | Redis metrics | < 80% WARN, < 60% PAGE |
| DB connection pool util | pg_stat | > 70% WARN, > 90% PAGE |
| Memory per pod | Kubernetes metrics | > 80% WARN, > 95% PAGE |
| Disk usage | Host metrics | > 70% WARN, > 85% PAGE |
| Certificate expiry | Cert-manager | < 30 days WARN, < 7 days PAGE |
| Audit log integrity | Hash chain verify | Any break → CRITICAL |
```

---

## 9. Quality Culture Rules

1. **No PR merges with failing tests.** CI is the gatekeeper, not humans.
2. **Every bug fix ships with a regression test.** The bug can never recur.
3. **Cross-service changes need TWO reviewers** (domain owner + platform engineer).
4. **Every release has a rollback plan.** Tested before deploy.
5. **Incidents get blameless post-mortems within 48h.** Action items tracked.
6. **Test in production (safely).** Canary deploys, feature flags, observability.
7. **Accessibility is not optional.** It's a legal requirement (GIGW 3.0, RPWD Act).
8. **Security is everyone's job.** Secret scanner runs on every commit.
9. **Performance budgets are enforced.** p95 regressions block releases.
10. **The user is always right.** UX bugs are P1, not P3.

---

*This document is the north star. Every test, every review, every deploy decision references it. The goal isn't just "no bugs" — it's a system that government officers trust with their daily work, that citizens rely on for services, and that survives everything the real world throws at it.*
