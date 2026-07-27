# CivitasOne — Quality Scorecard

**Generated:** 2026-07-27  
**Branch:** `feat/world-class-quality-program`  
**Evidence:** `/evidence/20260727/`

---

## Lane Summary

| Lane | Tests | Pass | Fail | Status | Verdict |
|------|-------|------|------|--------|---------|
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

**Totals:** 243 tests across 12 files. Release gate: **RELEASABLE** (all blocking lanes have passing evidence).

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

### Not Yet Built:
- ⬜ OWASP ZAP DAST against the gateway
- ⬜ Trivy container image scanning

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

### Not Yet Built:
- ⬜ k6 soak test (≥2h) wired as a gate
- ⬜ Chaos: kill-service / DB-failover / dep-down automation
- ⬜ DR backup→restore drill verification

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

## Release Gate

`scripts/ci/release-gate.mjs` audits the evidence pack rather than re-running tests.

| Property | Verified |
|----------|----------|
| Missing artifact → UNMEASURED → blocks (exit 1) | ✅ proven with an empty dir |
| Failing lane → blocks (exit 1) | ✅ proven by injecting `failures="3"` |
| Complete passing evidence → releasable (exit 0) | ✅ proven on the real pack |
| Empty suite (0 tests) → UNMEASURED, not a pass | ✅ enforced |

Blocking lanes: L1, L2, L3, L4, L6, L10, L11. Advisory (P2): L7, L8.

```bash
bash scripts/ci/quality-gates.sh all     # runs all lanes, then the release gate
node scripts/ci/release-gate.mjs         # audit today's evidence pack
```

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

## Next Steps

1. **Decide the fix for the 4 fabricating gov-integration routes** (needs product
   /security sign-off — this is the highest-value open item)
2. Wire L1/L2/L4/L7 into CI via the live-stack job (they need a running gateway)
3. Add OWASP ZAP DAST + Trivy container scanning to L6
4. Wire k6 soak + chaos automation as L7 gates
5. Expand TRACEABILITY.csv from 43 to all 270 capabilities
6. Complete B1 (Testcontainers ephemeral DB harness)
7. Add SLO / error-budget input to the release gate (currently evidence-only)
