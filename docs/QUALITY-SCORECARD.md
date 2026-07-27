# CivitasOne — Quality Scorecard

**Generated:** 2026-07-27  
**Branch:** `feat/world-class-quality-program`  
**Evidence:** `/evidence/20260727/`

---

## Lane Summary

| Lane | Tests | Pass | Fail | Status | Verdict |
|------|-------|------|------|--------|---------|
| L0 Deployment Readiness | 9 | 9 | 0 | 🟡 GREEN + FINDING | **4 of 41 not serving** (was 11 — 7 fixed) |
| L1 Tenant Isolation | 57 | 57 | 0 | ✅ GREEN | No cross-tenant leaks detected |
| L2 Authz / BOLA | 44 | 44 | 0 | ✅ GREEN | Role matrix enforced; JWT tamper blocked |
| L3 Data Integrity | 38 | 38 | 0 | ✅ GREEN | All money columns bigint; 0 violations |
| L4 API Contract | 16 | 16 | 0 | ✅ GREEN | 0 injection; 0 traversal; concurrent-safe |
| L5 Events | Existing | ✅ | — | ✅ GREEN | Gate #3 active (28 known defects baselined) |
| L6 Security | 18 | 18 | 0 | ✅ GREEN | AES-GCM verified; audit ledger immutable |
| L7 Reliability | 10 | 10 | 0 | ✅ GREEN | Honest 503s; p95 < 500ms; 0 5xx under load |
| L8 AI / Externals | 23 | 23 | 0 | 🟡 GREEN + FINDING | Fail-closed proven; **4 fabricating routes tracked** |
| L9 A11Y | Existing | ✅ | — | ✅ GREEN | axe-core gate active, 0 violations |
| L10 Domain | 26 | 26 | 0 | ✅ GREEN | 100% match to golden oracles |
| L11 Mutation/Canary | 11 | 11 | 0 | ✅ GREEN | 100% canaries caught |
| L11 Mutation Score | 1059 mutants | 755 killed | 253 survived | ✅ **71.29%** | Enforcing at 68; **≥70% criterion MET** |

**Totals:** 243 tests across 12 files, plus a measured SLO run.
Release gate: **RELEASABLE** — all blocking lanes have passing evidence and the
error budget is verified (read p95 10.2ms, 5xx 0.00%, 0% rate-limited).

---

## L1 — Tenant Isolation (P0) ✅ PASS

**Tested:** 42 resource-returning endpoints across 15 services  
**Method:** Cross-tenant JWT (T1 vs T2) via live gateway  
**Result:** 0 cross-tenant data leaks. All endpoints return empty/404 for wrong tenant.

### Controls Verified:
- ✅ tenantId filtering on all GET endpoints
- ✅ POST writes scoped to token's tenant (injected tenantId ignored)
- ✅ No-token → 401 on all endpoints
- ✅ Missing `tid` claim → 401/403
- ✅ Expired token → 401
- ✅ alg=none attack → 401
- ✅ Wrong secret → 401
- ✅ Tampered payload → 401

### Finding (non-security):
- `knowledge-service` returns 502 (service unhealthy) — operational, not isolation issue

---

## L2 — Authorization / BOLA (P0) ✅ PASS

**Tested:** 9 endpoint × role combinations (positive + negative)  
**Method:** Role-specific JWTs against live gateway

### Controls Verified:
- ✅ Finance endpoints enforce `finance_officer`/`finance_admin`/`super_admin`
- ✅ HRMS endpoints enforce `hr_officer`/`hr_admin`/`super_admin`
- ✅ Procurement endpoints enforce `procurement_officer`/`super_admin`
- ✅ Audit endpoints enforce `audit_officer`/`super_admin`
- ✅ `citizen` role correctly denied on all admin endpoints
- ✅ `employee` role correctly denied on all admin endpoints
- ✅ Mass assignment protection (injected `tenantId`, `roles`, `status` ignored)
- ✅ JWT alg=none rejected
- ✅ JWT wrong-secret rejected
- ✅ JWT payload tampering rejected

### Design Decision (not a bug):
- `procurement_officer` has read access to `/api/v1/finance/sanctions` (intentional for 3-way match)
- Defined in `READER_ROLES = [...FINANCE_ROLES, "audit_officer", "procurement_officer"]`

---

## L3 — Data & Schema Integrity (P0) ✅ PASS

**Tested:** 18 service databases scanned  
**Method:** Direct schema introspection via psql

### All money columns now use bigint (paise):
- ✅ citizen.fee.payments.amount → bigint
- ✅ citizen.fee.refunds.amount → bigint
- ✅ citizen.fee.schedules.base_amount → bigint
- ✅ legal.rti.rti_applications.fee_paid → bigint
- ✅ legal.rti.rti_applications.additional_fee → bigint
- ✅ workflow.authority_limits.max_amount → bigint

### Excluded (not money):
- finance.treasury.finance_guarantees.fee_pct — percentage, not money
- hrms.learning.courses.credit_hours — hours, not money

### Other Checks:
- ✅ RLS: no service roles have BYPASSRLS
- ✅ Double-entry: no unbalanced vouchers in finance GL
- ✅ Timestamps: all timestamptz (verified)

---

## L6 — Security (P1) ✅ PASS

**Tested:** 18 tests covering cryptography and audit ledger integrity

### Cryptography (AES-256-GCM PII encryption):
- ✅ IV uniqueness: 100 encryptions of the same plaintext → 100 distinct ciphertexts
- ✅ IV segment differs across encryptions (verified byte-level)
- ✅ Auth tag verification: bit-flip in ciphertext → decrypt throws
- ✅ Auth tag tamper → decrypt throws
- ✅ Truncated ciphertext → decrypt throws (no partial plaintext)
- ✅ Fail-closed: missing `PII_ENC_KEY` → encrypt throws (never stores plaintext)
- ✅ Fail-closed: short key (<16 chars) → throws
- ✅ Wrong key → decrypt throws (no garbage returned)
- ✅ No plaintext leakage in ciphertext
- ✅ Round-trip exact for unicode, long values, empty string
- ✅ Envelope format `enc:v2:<keyid>:` verified
- ✅ Legacy plaintext passes through on read (backfill safety)

### Audit Ledger Immutability (CERT-In):
- ✅ Immutability trigger present on `events.events`
- ✅ No-truncate trigger present
- ✅ TRUNCATE rejected (statement-level trigger fires even on empty table)
- ✅ **UPDATE rejected** — gap now closed. The test seeds one audit row inside the
  probe transaction so the row-level trigger has a target; Postgres raises
  `events.events is append-only: UPDATE is not permitted (AUD-1)`. Verified the
  test can fail by neutering the mutation to `SELECT 1` → test failed as expected.
- ✅ **DELETE rejected** — same mechanism, `AUD-1` raised. Transaction is always
  rolled back, so the seeded row never persists.

### Existing CI Security Gates (already in `.github/workflows/security.yml`):
- ✅ CodeQL SAST (security-and-quality queries)
- ✅ gitleaks secret scanning
- ✅ `pnpm audit --prod --audit-level=moderate`

### Added this round (CI-only — cannot execute locally)
- ✅ **Trivy container scan** — `gateway`, `finance`, `hrms` images. Blocks on
  CRITICAL/HIGH **with a known fix** (`ignore-unfixed: true`); unfixed CVEs are
  reported via SARIF but do not block, since no action is available.
- ✅ **OWASP ZAP baseline DAST** with a ratcheting `.zap/rules.tsv`: injection,
  traversal, code-injection and error-disclosure classes are `FAIL`; header
  posture is `WARN` pending the real-gateway fix; four rules are `IGNORE`d with
  recorded reasons.

**Scope limit, stated plainly:** ZAP runs against `start-mock-gateway.mjs`, a
static-JSON fixture — not the production gateway. It exercises the HTTP surface
deterministically in CI. It is **not** a full authenticated scan of a live fleet,
and no such claim is made. Trivy has not run on this machine (not installed), so
its result is unverified until CI executes it.

---

## L7 — Reliability (P2) ✅ PASS

**Tested:** 10 tests against the live stack

- ✅ `/health` returns a real status object (uptime, service, status) — not a hardcoded "ok"
- ✅ Unreachable upstream → 404/502/503, never a fabricated 200
- ✅ Read-path p95 latency < 500ms across 4 endpoints (20 requests each)
- ✅ 50 sequential reads → zero 500s
- ✅ 20 concurrent reads → zero 500s
- ✅ Cache-busting reads still succeed (graceful degradation, no 500 on cache miss)
- ✅ 150-request burst → rate limited or clean, zero 500s

### Gaps closed this round:
- ✅ **Latency SLO no longer reads clean when unmeasurable.** Previously an
  all-down endpoint produced zero samples and silently passed. Now requires ≥15
  of 20 requests to return 200, else fails with the observed status histogram.
- ✅ **Burst test no longer poisons other lanes.** The 150-request burst shared the
  test actor, so the gateway's per-user rate-limit bucket pushed later L8 requests
  into 429 — order-dependent coupling (B2 violation). The burst now uses a
  dedicated actor.

### SLO measurement (k6) — now the release gate's error-budget input

`tests/load/k6-slo.js` + `scripts/ci/run-slo-measurement.sh` produce
`evidence/<date>/L7-k6-slo.json`, which `release-gate.mjs` consumes.

Latest measured run (361 requests over 30s):

| Metric | Measured | Threshold | Verdict |
|--------|----------|-----------|---------|
| Read p95 | 10.2 ms | < 500 ms (dev) / 200 ms (`SLO_STRICT=1`) | ✅ |
| 5xx rate | 0.00% | < 1% | ✅ |
| Rate-limited | 0.00% | < 20% | ✅ |
| Measured reads | 361 | > 252 (70% floor) | ✅ |

**Finding — rate limiting is keyed by IP, not by user.** The steering doc states
"100 req/min per user". What is implemented in `gateway-service/src/app.ts` is a
**global 1000 req/min using fastify's default keyGenerator (`req.ip`)**, plus a
per-tenant 200/min tier that keys on the `x-tenant-id` header and falls back to
IP when absent.

Proven: a 30s run at 50 req/s returned exactly 1000 successes then 501 × 429, and
raising the actor count from 1 → 40 moved the limited share only from 33.33% to
33.37%. Distinct users share one bucket.

Consequences: (a) the documented per-user limit does not exist, so one user can
consume the whole IP budget — the noisy-neighbour protection L1 asks for is
weaker than documented; (b) any load generator behind a single egress IP measures
the limiter rather than the service. The SLO run therefore holds 12 req/s, below
the 16.6 req/s ceiling, and fails if >20% of responses are 429 so a limiter-bound
run can never be mistaken for an SLO measurement.

### Not Yet Built:
- ⬜ k6 soak test (≥2h) wired as a gate
- ⬜ Chaos: kill-service / DB-failover / dep-down automation
- ⬜ DR backup→restore drill verification

---

## L0 — Deployment Readiness 🟡 GREEN WITH P0 FINDING

**Why this lane exists:** every other lane tests services that *are* serving.
None notices a service that is not. Measured 2026-07-27 against a fleet pm2
reported as **65/65 online**: **11 of 41 services were not serving traffic**,
while every per-service suite was green.

### P0 FINDING — pm2 "online" is not readiness — ✅ ROOT-CAUSED AND FIXED

| Service | Port | pm2 said | Reality | Now |
|---|---|---|---|---|
| payroll | 3013 | online, 39 restarts | **not bound** → 502 | ✅ 200 |
| admin | 3022 | online, 14 restarts | **not bound** → 502 | ✅ 200 |
| knowledge | 3028 | online, 9 restarts | **not bound** → 502 | ✅ 200 |

**Root cause: three shared packages declared `exports` pointing at
`./src/*.js` while shipping compiled output to `dist/`.** `src/` holds
TypeScript, so those paths never exist at runtime:

| Package | Broken entry points |
|---|---|
| `@civitasone/render` | `.`, `./pdf`, `./xlsx` |
| `@civitasone/storage` | `.` |
| `@civitasone/gov-adapters` | `./pfms`, `./nach`, `./traces`, `./gstn` |

Node threw `ERR_MODULE_NOT_FOUND` on the first import, so `await buildApp()`
rejected **before any socket was opened**. The process stayed alive on pm2's IPC
channel, sitting in `epoll_wait` with **zero TCP sockets** — which pm2 reports as
"online". Three services were down for ~20 hours with empty error logs.

Diagnosis path: pm2 PIDs did not match the PIDs in the logs (the logged PIDs were
an older, working generation); `/proc/<pid>/fd` showed only pm2 IPC sockets and
pipes; `wchan` = `ep_poll`. Zero TCP ruled out a DB/Redis connect failure and
pointed at a module-resolution crash, confirmed by running the service in the
foreground.

`pnpm typecheck` cannot catch this — `tsc` resolves via source paths, not the
published `exports` map. Only a runtime import or a static check sees it.

**Guarded against recurrence:** `scripts/ci/package-exports-guard.mjs`, wired into
the arch-guard CI job. It scans all 27 packages and fails on any `main`/`types`/
`exports` target that does not exist, naming the `dist/` alternative when present.
It found 5 entry points beyond the two that had already broken.

### Brought up 2026-07-27 (4) — meeting, court, visitor, inspection

All four verified: port bound, `/health` 200, and reachable through the gateway.
Fleet 35 → **39 listening ports**. The launch had been blocked by three things,
none of which was a code defect:

| Blocker | Detail |
|---|---|
| `INTERNAL_SERVICE_SECRET` absent from the launching shell | `@civitasone/auth/plugin` refuses to start; process survives on pm2's IPC so pm2 reports "online" |
| **`RUNTIME_NODE_ENV`, not `NODE_ENV`** | `ecosystem.config.js` injects `NODE_ENV: RUNTIME_NODE_ENV`. Setting `NODE_ENV=staging` alone leaves the service running as `production` — it only flips the ecosystem's own `IS_PROD` decision |
| **`JWT_ALGORITHM` defaults to `RS256`** | Miss it and the service binds its port and answers `/health` 200 while **every gatewayed request returns 401**, because the fleet issues HS256 tokens. Presents as an auth bug; is purely a launch-env mismatch |

**inspection additionally had no database at all.** Neither the `inspection_svc`
role nor `civitas_inspection` existed — so a service with 39 test files at 78.6%
coverage, declared in the ecosystem and routed in the gateway, could never have
started. Provisioned via the new
`infra/db/bootstrap/bootstrap_inspection.sql` (role `NOSUPERUSER NOBYPASSRLS`, db
owned by `civitas_admin`, service role gets `USAGE` + DML but never ownership —
mirroring the verified `civitas_court` convention), then all 16 migrations applied
clean → 42 tables.

The L0 staleness ratchet then failed on all four, forcing the inventory 8 → 4.

### Still not serving (4) — blocked on database provisioning

| Service | Blocker |
|---|---|
| `revenue` | `revenue_svc` role and `civitas_revenue` database **do not exist** |
| `works` | `works_svc` role and database do not exist |
| `ml` | `ml_svc` role and database do not exist |
| `metadata` | role exists; not yet started |

`revenue` remains the sharpest case: highest line coverage in the fleet (99.6%)
and still no database to connect to.

### Previously (8) — declared and routed, blocked on secrets

Build quality is not the issue: court has 50 test files at 88.9%, meeting 58 at
93.3%, visitor 45 at 81.2%, revenue 37 at 99.6%.

**Two declaration gaps, now fixed:**

| Gap | Services | Fix |
|---|---|---|
| Absent from `ecosystem.config.js` — undeployable by construction | `works`, `metadata` | `svc()` entries added |
| No gateway route — every request 404s | `revenue`, `metadata` | prefixes added to the registry |
| No PII key supplied, so the service fail-closes at boot | `court`, `meeting`, `visitor` | key resolvers added via a `piiKey()` factory (env → host key file → dev fallback, fail closed in prod) |

`inspection` needed no change — its required-env allowlist was already fully
supplied. An earlier probe reported it failing; that probe used a hand-built env
missing `S3_BUCKET_NAME`/`HRMS_SERVICE_URL`. **The defect was in the probe, not
the config**, and the earlier scorecard entry was wrong.

**Remaining blocker — a config inconsistency, not a code defect.** `svc()` injects
`NODE_ENV=production` into every app, while the ecosystem decides `IS_PROD` from
the *shell* `NODE_ENV`. Launched without secrets in the launching shell, a service
receives an empty `INTERNAL_SERVICE_SECRET` together with `NODE_ENV=production`,
and `@civitasone/auth/plugin` correctly refuses:

```
Error: INTERNAL_SERVICE_SECRET must be set in production; refusing to start.
```

That is fail-closed behaviour working as intended. Bringing these 8 up requires
the real `INTERNAL_SERVICE_SECRET` / `DEVICE_TRUST_SECRET` (plus per-service PII
keys) injected from the secret manager at launch — an operational step,
deliberately not automated. The running fleet was left unchanged at 33/41.

### Guarded against recurrence

`scripts/ci/deployment-declaration-guard.mjs` (wired into the arch-guard CI job)
fails if any service in `services/` is missing from `ecosystem.config.js` or from
the gateway registry. `gateway` and `queue` are exempt with recorded reasons.
Verified genuine: deleting the `works` ecosystem entry and the `revenue` route
produced `UNDEPLOYABLE — works` and `UNREACHABLE — revenue`, exit 1.

### Built but unreachable (2)
| Service | State |
|---|---|
| **revenue** | 37 test files, **99.6% coverage — highest in the fleet** — and no gateway route (404) |
| **metadata** | 8 test files, no coverage report, no gateway route (404) |

Revenue is the textbook "scored Implemented but unreachable" defect: it passes
every per-service and coverage gate while being impossible to call from the web app.

### The three checks, and why each is separate
1. **Port bound** (`ss -tln`) — catches the pm2-online lie
2. **Gateway route present** (registry parse) — catches revenue/metadata
3. **Reachable** (request through gateway) — catches 502/404

Plus discovery guards: if `ss` fails or the registry cannot be parsed, the lane
**fails loudly** rather than reporting every service down (a false alarm) or clean.

### Verified genuine
| Injected | Result |
|---|---|
| Removed `payroll` from the tracked inventory | ❌ Fails, names it, on **2 independent checks** |
| Added a stale entry for the serving `finance` | ❌ Fails: "now serving but still listed" |

Ratcheted: the non-serving count may not grow, and a recovered service must be
removed from the inventory or the gate fails.

**The ratchet proved itself in production use.** After payroll/admin/knowledge came
up, the staleness check failed with *"3 service(s) are now serving but still listed
in KNOWN_NOT_SERVING"* — forcing the inventory down from 11 to 8 rather than
letting a stale entry silently re-admit a regression.

---

## L8 — AI / External Integrations 🟡 GREEN WITH P1 FINDING

**Tested:** 23 tests (19 runtime + 4 static)

### What passes
- ✅ All 7 gov-integration routes fail closed — verified **direct-to-service**
  (`127.0.0.1:3001`) returning `503 NOT_CONFIGURED`, not via the gateway where a
  circuit-breaker 503 would have made the test pass for the wrong reason
- ✅ Aadhaar, PAN/NIC, DigiLocker, GSTN all confirmed env-gated
- ✅ AI assistant routes fail closed with no provider configured
- ✅ 4 prompt-injection payloads not honoured; no system prompt or credential echo
- ✅ No `ANTHROPIC_API_KEY` / `sk-ant-` / `x-api-key` / `JWT_SECRET` leakage in error paths
- ✅ Injection text in a normal data field does not bypass tenant scoping
- ✅ **Unreachable fleet now fails loudly.** The direct-to-service tests previously
  swallowed connection errors and returned, so an entirely down fleet read GREEN
  while asserting nothing. A `beforeAll` probe now fails with a diagnostic unless
  `QUALITY_ALLOW_OFFLINE=1` is set, making the gap visible instead of silent.
  Verified against a dead port: 4 tests fail with the expected message; with the
  opt-out set, 19 pass.

### P1 FINDING — fabricated verification verdicts

Every gov-integration route fails closed correctly. But once its credential env
var is set to **any non-empty value**, four routes return a hardcoded
authoritative-looking verdict **without ever contacting the upstream authority**:

| Route | Fabricated response | Severity |
|-------|--------------------|----------|
| `POST /identity/gov/aadhaar/otp-verify` | `{ verified: true, name: "REDACTED" }` | **P1 — any 6-digit OTP passes Aadhaar eKYC** |
| `POST /identity/gov/nic/validate-pan` | `{ valid: true, name: "VERIFIED" }` | **P1 — every PAN validates** |
| `POST /identity/gov/digilocker/pull-document` | `{ verified: true, uri: "dl://…" }` | **P1 — every document verifies** |
| `GET /identity/gov/gstn/verify/:gstin` | `{ tradeName: "Verified Entity", status: "active" }` | **P2 — every GSTIN active** |

Setting `UIDAI_API_KEY=x` in staging makes every Aadhaar OTP verification succeed.
A caller cannot distinguish this from a real UIDAI response. For a statutory KYC
surface this is worse than an outage, because it is silent.

`fail-closed` ✅ · `never-fabricate` ❌

**Status:** NOT fixed in this PR. Implementing real UIDAI/NIC/DigiLocker clients
is a product effort, and unilaterally flipping `verified: true` → `false` on an
auth-critical KYC path needs product/security sign-off. Filed as tracked debt and
ratcheted by `L8-ai-features/no-fabricated-verdicts.test.ts`, which **fails if a
new fabricating route is added** and **also fails if a fixed one is left in the
baseline** (so a regression cannot slip back for free).

**Recommended fix:** return `501 NOT_IMPLEMENTED` when the credential is present
but no real client is wired, or tag the payload `{ verified: false, source: "stub" }`.

---

## L11 — Mutation Testing 🟡 ENFORCING, BELOW TARGET

### P1 FINDING — the mutation gate was theater

`stryker.config.mjs` mutates 8 domain files including the payroll engine, GL
double-entry and F&F settlement. But `vitest.mutation.config.ts` loaded only
**7 test files** — none from payroll, none covering `gl/domain.ts`,
`fnf/domain.ts` or `payments/domain.ts`. And `thresholds.break` was `null`, so the
gate **could never fail**.

Reported score before the fix: **35.1%** — but **561 of 1029 mutants were
`NoCoverage`**, which contradicts payroll's 86% line coverage. That number
described the runner's include-list, not the test suites. The config comment
admits why the list was trimmed: files with pre-existing failures make Stryker
abort its dry-run.

Net effect: the salary, tax, pension and double-entry engines — where a bug means
wrong pay or an unbalanced ledger — had **zero mutation coverage**, under a gate
that could not go red.

### After fixing the runner scope

Added payroll/F&F/GL/payments suites plus the L10 golden-oracle and L11 canary
tests (each verified to pass in isolation first, since Stryker aborts otherwise).
Two DB-dependent files excluded to keep the run hermetic.

| File | Scope-fix | Payroll pass | Payments+F&F pass | Survived | NoCov |
|---|---|---|---|---|---|
| `payroll/domain.ts` | 0/430 → **37.4%** | **60.2%** | 60.2% | 149 (was 176) | 22 (was 93) |
| `payments/domain.ts` | 32% → 57.7% | 57.7% | **70.9%** | 30 | 11 |
| `fnf/domain.ts` | 0/52 → **59.6%** | 59.6% | **96.2%** | 2 | 0 |
| `gl/domain.ts` | 0/23 → **87.0%** | 87.0% | 87.0% | 3 | 0 |
| `quorum/domain.ts` | 73.0% | 73.0% | 73.0% | 35 | 8 |
| `authority/domain.ts` | 73.6% | 73.6% | 73.6% | 21 | 7 |
| `budget/domain.ts` | 81.8% | 81.8% | 81.8% | 12 | 0 |
| `decisions/domain.ts` | 98.8% | 98.8% | 98.8% | 1 | 0 |

**Overall 35.1% → 58.31% → 68.03% → 71.29%.** Killed 600 → 755.
NoCoverage 128 → 48. **The ≥70% L11 exit criterion is now met at suite level.**
`payroll/domain.ts` at 60.2% is the only file still short.

### Payroll burn-down (2026-07-27)

`tests/quality-program/L10-domain-correctness/payroll-slip-mutants.test.ts`
(55 tests). Targets chosen from `scripts/ci/mutation-survivors.mjs`, which grouped
the 269 survivors by mutator — so the work went at real logic, not label strings:

| Target | Why it mattered |
|---|---|
| ESI cap boundary + both rates | `gross * 75n * 10000n` and `/ 325n` both survived — the rate arithmetic was entirely unasserted |
| `extraIncome` sign | a **minus** survived: declared perquisites / previous-employer salary could have been *subtracted* from taxable pay |
| Whole old-regime branch | NoCoverage — HRA exemption, 80C/80D caps, PT deduction all unexercised |
| `grossMinor * 12n` | `/ 12n` survived, i.e. annualisation could have divided |
| Zero-component omission | `daMinor > 0n`, `hraMinor > 0n`, `amt === 0n` guards unasserted |
| Recovery floor | conservation (applied + carried == demanded) and floor never breached |
| EPF wage ceiling | 12% of the Rs 15,000 cap vs 12% of actual pay |

All expected values were computed by hand from the statutory rule and the
documented constants, not read back from the implementation.

### Payments + F&F burn-down (2026-07-27) — and a real defect found

`payments-domain-mutants.test.ts` (64 tests) + `fnf-settlement-mutants.test.ts`
(22 tests).

**P1 DEFECT FOUND AND FIXED — three-way-match tolerance under-reported overage,
always in the vendor's favour.**

The accept/reject decision was `overagePct(value, cap) > tolerancePct`, routing a
money comparison through a truncating BigInt division and then a float. The
measured overage was quantised **down** to 0.01%-of-cap steps, and because
truncation is always toward zero the error **always admitted** overage — i.e.
authorised paying more than the PO. Measured:

| PO | GRN overage | Reported | True | At 2% tolerance |
|---|---|---|---|---|
| ₹1,000 | +₹20.01 | 2.00% | 2.001% | **admitted** |
| ₹1 crore | +₹999.99 | **0.00%** | 0.010% | **admitted even at ZERO tolerance** |

The quantum is `cap / 10000` paise, so the larger the order the more slips
through: ₹999.99 on a ₹1 crore PO.

Fixed by adding `exceedsTolerance()`, which compares in exact integer arithmetic
with no float and no truncation — `(value - cap) * 10000 > cap * toleranceBps`.
The boundary stays exclusive (exactly-at-tolerance is still allowed, preserving
the existing contract). `overagePct()` is retained for error messages only, now
documented as reporting-only. **finance-service: 868/868 tests still pass**, so
the tightening broke nothing.

**Also found: the maker-checker SoD guard on the money path was entirely
NoCoverage.** Every mutant survived, including `creatorId !== approverId`, which
inverts the check — self-approval of a disbursement would have been permitted with
no test failing. Now covered, including a documented weakness asserted so it
cannot change silently: the guard requires *both* ids truthy, so two empty-string
actor ids bypass it. Callers must validate presence; the function does not.

### Honest status

**71.29% meets the L11 exit criterion of ≥70%** at suite level. `break` raised
65 → **68**, held just under the measured score so a regression fails the build.

`payroll/domain.ts` at 60.2% is the **only file still below 70%**, with 149
surviving mutants. The suite-level pass does not make that file safe.

Verified enforcing: `break: 95` produced
`Final mutation score 58.79 under breaking threshold 95, setting exit code to 1`.

```bash
npx stryker run                                        # the gate
node scripts/ci/mutation-summary.mjs                   # per-file score
node scripts/ci/mutation-survivors.mjs "payments/domain" 40   # next target
```

---

## Release Gate

`scripts/ci/release-gate.mjs` audits the evidence pack rather than re-running tests.
Every failure path was proven by injection, not assumed:

| Property | Verified |
|----------|----------|
| Missing artifact → UNMEASURED → blocks (exit 1) | ✅ empty dir → exit 1 |
| Failing lane → blocks (exit 1) | ✅ injected `failures="3"` → exit 1 |
| Complete passing evidence → releasable (exit 0) | ✅ real pack → exit 0 |
| Empty suite (0 tests) → UNMEASURED, not a pass | ✅ enforced |
| **SLO p95 breach → blocks** | ✅ injected p95 812ms → exit 1 |
| **SLO 5xx breach → blocks** | ✅ injected 5.5% → FAIL |
| **SLO 0 reads → UNMEASURED** | ✅ injected count 0 → UNMEASURED |
| **Missing SLO + `--require-slo` → blocks** | ✅ exit 1 |
| Missing SLO without the flag → releasable **but annotated** | ✅ prints an explicit note that no error budget was asserted |

Blocking lanes: L0, L1, L2, L3, L4, L6, L10, L11, plus SLO on breach.
Advisory (P2): L7, L8. SLO UNMEASURED blocks only under `--require-slo`.

```bash
bash scripts/ci/quality-gates.sh all     # lanes + SLO + release gate
bash scripts/ci/quality-gates.sh slo     # SLO measurement only
node scripts/ci/release-gate.mjs         # audit today's evidence
node scripts/ci/release-gate.mjs --require-slo   # treat missing SLO as a block
SLO_STRICT=1 node scripts/ci/release-gate.mjs    # enforce the 200ms prod target
```

**What "RELEASABLE" does and does not mean.** With an SLO artifact present it
means the blocking lanes passed *and* the error budget is healthy. Without one it
means only that the lanes passed — the gate says so explicitly rather than
implying an unverified SLO.

---

## Operational Findings (Not Security)

| Service | Issue | Severity |
|---------|-------|----------|
| knowledge-service | Returns 502 via gateway | P3 |
| admin-service | `/health` returns 503 | P3 |

---

## CI Gate Status (Updated)

| Gate | Blocking | Status |
|------|----------|--------|
| Typecheck + Lint | ✅ Yes | Green |
| Secret Scan | ✅ Yes | Green |
| Unit Tests | ✅ Yes | Green |
| Architecture Guard | ✅ Yes | Green |
| Contract Tests (events) | ✅ Yes | Green (baselined) |
| Screen Verification | ✅ Yes | Green |
| Accessibility (axe-core) | ✅ Yes | Green |
| Coverage Gate (80%) | ✅ Yes | Green |
| **L3 Schema Integrity** | ✅ Yes (new) | Green |
| **L6 Security (crypto+audit)** | ✅ Yes (new) | Green |
| **L10 Domain Correctness** | ✅ Yes (new) | Green |
| **L11 Canary Validity** | ✅ Yes (new) | Green |
| L1 Tenant Isolation | ⬜ Local only | Green (needs live stack) |
| L2 Authz Matrix | ⬜ Local only | Green (needs live stack) |
| L4 API Contract | ⬜ Local only | Green (needs live stack) |
| L7 Reliability | ⬜ Local only | Green (needs live stack) |

---

## Open Decisions (need a human)

1. **The 4 fabricating gov-integration routes** — highest-value open item. Needs
   product/security sign-off because it changes behaviour on an auth-critical KYC
   path. Recommended: `501 NOT_IMPLEMENTED` when a credential is set but no real
   client is wired.
2. **Rate limiting is IP-keyed, not user-keyed** — the documented "100 req/min per
   user" does not exist. Decide whether to implement per-user limiting (add a
   `keyGenerator` on the user claim) or correct the steering doc.

## Next Steps

1. **Provision `revenue_svc`, `works_svc`, `ml_svc` roles and databases**, then
   launch those three plus `metadata`. Use
   `infra/db/bootstrap/bootstrap_inspection.sql` as the template and apply each
   service's migrations as `civitas_admin`. Takes the fleet 39 → 41/41.
   `revenue` is the priority: 99.6% coverage and still no database.
2. **Reconcile `IS_PROD` with the injected `NODE_ENV`** in `ecosystem.config.js` —
   deciding prod-ness from the shell while forcing `NODE_ENV=production` into the
   app is the trap that makes a secret-less launch fail confusingly.
3. **Extend L1/L2/L4 to `revenue` and `metadata`** once running — routes now exist,
   but their isolation and authz remain unverified.
4. **Finish the mutation burn-down on `payroll/domain.ts`** — 60.2%, the only
   file still under 70%, with 149 surviving mutants; raise `thresholds.break` as
   it lands.
5. Wire L1/L2/L4/L7 into CI via the live-stack job (they need a running gateway)
6. Verify Trivy + ZAP actually pass in CI — both are wired but **unexecuted** on
   this machine, so their status is unproven
7. Wire k6 soak (≥2h) + chaos automation as L7 gates
8. Expand TRACEABILITY.csv from 98 to all 270 capabilities
9. Complete B1 (Testcontainers ephemeral DB harness)
10. Fix the header-posture ZAP `WARN` rules on the real gateway, then ratchet to `FAIL`
