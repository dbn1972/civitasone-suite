# HRMS End-to-End Test Suite — World-Class Edition (v2)

> A comprehensive, production-grade test prompt designed to be executed by a team of AI agents. Tests 150+ scenarios across functional correctness, business rules, security, performance, concurrency, idempotency, multi-tenancy, statutory compliance, and regression.

---

## INSTRUCTIONS FOR THE AGENT TEAM

You are a **team of senior SDET engineers** (Google/Microsoft caliber) testing CivitasOne HRMS. You will execute this test suite against live microservices with zero tolerance for:
- Unhandled 500 errors (every error must be a clean envelope)
- Cross-tenant data leakage (tenant isolation is non-negotiable)
- Business rule bypasses (CCS Leave Rules, GFR, EPF Act compliance)
- Data corruption (idempotency, CQRS eventual consistency)

**Environment:**
- Gateway: `http://localhost:8080`
- Auth: HS256 dev tokens (mint per test section — see setup below)
- CQRS: writes are async (202) → wait 3-5s → verify reads
- Two test tenants: TENANT_A (`00000000-0000-0000-0000-000000000001`), TENANT_B (create fresh)

**Reporting format:**
```
[PASS] 3.4 Leave balance exceeded → 422 LEAVE_RULE_VIOLATION (47ms)
[FAIL] 3.7 Sandwich rule → Expected warning, got none. Response: {...}
[PERF] 5.3 Payroll run detail → 340ms (WARN: >200ms SLA)
```

**At the end, produce:**
1. Score: X/Y passed (with breakdown by section)
2. Critical failures (blocks production)
3. Performance violations (>200ms p95)
4. Security findings (tenant leakage, auth bypass)
5. Compliance gaps (statutory rules not enforced)
6. Ranked fix list (what to fix first)

---

## SETUP: Token Minting

```javascript
function mintToken(tenantId, roles = ["super_admin","hr_admin","finance_admin","payroll_admin"]) {
  const { createHmac } = require("node:crypto");
  const SECRET = "civitasone-dev-secret";
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub: "00000000-0000-0000-0000-000000000099", iss: "civitasone-dev", tid: tenantId, tenantId, sid: "e2e", roles, iat: now, exp: now + 7200 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const TOKEN_A = mintToken("00000000-0000-0000-0000-000000000001");
const TOKEN_B = mintToken("<TENANT_B_ID>"); // Create tenant B first
```

---

## SECTION 1: MASTER DATA (14 tests)

Standard CRUD for foundational configuration. Every test asserts response shape + status code + response time.

| # | Test | Method | Endpoint | Assertions |
|---|------|--------|----------|-----------|
| 1.1 | List departments | GET | /api/v1/hrms/departments | 200, `{ data: [...] }`, array, <100ms |
| 1.2 | Create dept "E2E-QA" | POST | /api/v1/hrms/departments | 201, returns id |
| 1.3 | Create duplicate dept code | POST | /api/v1/hrms/departments | Idempotent (no crash) OR 409 |
| 1.4 | List designations | GET | /api/v1/hrms/designations | 200, includes pay level |
| 1.5 | Create designation "E2E-SDET" L8 | POST | /api/v1/hrms/designations | 201 |
| 1.6 | List employee types | GET | /api/v1/hrms/employee-types | 200, ≥5 types, each has payMode + eligibility flags |
| 1.7 | Create custom type "visiting_faculty" | POST | /api/v1/hrms/employee-types | 201 |
| 1.8 | Update custom type (PATCH) | PATCH | /api/v1/hrms/employee-types/:id | 200, verify change persisted |
| 1.9 | List leave types | GET | /api/v1/hrms/leave-types | 200, ≥5 types (CL, EL, HPL, MED, EOL) |
| 1.10 | List leave policies | GET | /api/v1/hrms/admin/leave-policies | 200, covers ≥5 employee types |
| 1.11 | Create policy: volunteer CL=0 | POST | /api/v1/hrms/admin/leave-policies | 201, maxDaysPerYear=0 |
| 1.12 | List holidays | GET | /api/v1/hrms/holidays | 200, ≥1 holiday |
| 1.13 | Create holiday (Republic Day) | POST | /api/v1/hrms/holidays | 202 |
| 1.14 | Payroll structures exist | GET | /api/v1/payroll/structures | 200, ≥1 structure |

---

## SECTION 2: EMPLOYEE ONBOARDING (12 tests)

Create employees of every type, verify CQRS persistence, test validation boundaries.

| # | Test | Assertions |
|---|------|-----------|
| 2.1 | Create permanent employee (7th CPC L10, ₹56,100) | 202 + persists with correct type/pay |
| 2.2 | Create contractual (₹1,20,000 consolidated) | 202 + employeeType="contract" |
| 2.3 | Create intern (₹15,000 stipend) | 202 + employeeType="intern" |
| 2.4 | Create apprentice (₹8,000 stipend) | 202 + employeeType="apprentice" |
| 2.5 | Create volunteer (₹0) | 202 + eligibleForPayroll=false |
| 2.6 | Create deputation officer (₹1,44,200 govt scale) | 202 + employeeType="deputation" |
| 2.7 | **Duplicate employeeNo** | Should not crash — either 409 or idempotent |
| 2.8 | **Missing required field** (no fullName) | 400 VALIDATION_FAILED with field error |
| 2.9 | **Invalid employeeType** ("xyz") | 400 validation |
| 2.10 | **Future joining date** (2027-01-01) | Should SUCCEED (pre-boarding is valid) |
| 2.11 | **Negative basicMinor** | 400 validation |
| 2.12 | Wait 5s → List all, verify all 6 types present | 200, all visible with correct employeeType + basicMinor |

---

## SECTION 3: LEAVE RULES ENGINE — EXHAUSTIVE (20 tests)

The CCS Leave Rules engine is the most complex business logic. Test every rule branch.

| # | Rule | Test | Expected |
|---|------|------|----------|
| 3.1 | Balance check | Apply 1 CL with 8-day balance | 202 (valid) |
| 3.2 | Balance check | Apply 9 CL with 8-day balance | 422 "Insufficient balance" |
| 3.3 | Balance check | Apply exactly 8 CL with 8-day balance | 202 (edge: exact limit) |
| 3.4 | Probation | Apply EL during probation | 422 "Only CL allowed during probation" |
| 3.5 | Probation | Apply CL during probation | 202 (CL is allowed) |
| 3.6 | Gender (Maternity) | Male applies for ML | 422 "for women only" |
| 3.7 | Gender (Paternity) | Female applies for PL | 422 "for male only" |
| 3.8 | Gender (Maternity) | Female applies for ML | 202 |
| 3.9 | Service requirement | Apply Study Leave with <5yr service | 422 "requires minimum 5 years" |
| 3.10 | Employee type | Contractual applies for EL | 422 "not available for contract" |
| 3.11 | Employee type | Permanent applies for EL | 202 |
| 3.12 | Sandwich rule | CL on Fri + Mon (Sat-Sun in between) | Warning "sandwich rule applied" |
| 3.13 | Prefix-suffix | CL on Monday after a holiday Friday | Warning "prefix/suffix" |
| 3.14 | Max continuous | Apply CL for 10 continuous days (max=8) | 422 "exceeds maximum" |
| 3.15 | Max continuous | Apply CL for exactly 8 days | 202 |
| 3.16 | CCL (Child Care) | Male applies | 422 "women only" |
| 3.17 | CCL | Female with 2+ children | 422 "not available for 2+" |
| 3.18 | Holiday-aware | Apply 5 CL Mon-Fri, Wed is holiday | computedDays=4 (working days method) |
| 3.19 | **Concurrent allocation debit** | Two applications for same allocation submitted simultaneously | Only one succeeds (dedup/lock) |
| 3.20 | **FY boundary** | Leave spanning 31 Mar → 1 Apr | Correctly attributed to FY |

---

## SECTION 4: ATTENDANCE & REGULARISATION (8 tests)

| # | Test | Expected |
|---|------|----------|
| 4.1 | List today's attendance | 200 |
| 4.2 | Record check-in (normal time) | 202, status="present" |
| 4.3 | Record check-in (late — after grace) | Should mark "late" |
| 4.4 | Record check-in (very late — after half-day cutoff) | Should mark "half_day" |
| 4.5 | Submit regularisation request | 202 |
| 4.6 | List regularisation requests | 200, shows pending |
| 4.7 | Approve regularisation | 202, original record corrected |
| 4.8 | WFH request | POST /api/v1/hrms/wfh-requests → 200/202 |

---

## SECTION 5: PAYROLL — COMPUTE + STATUTORY (15 tests)

| # | Test | Expected |
|---|------|----------|
| 5.1 | Create payroll run (Jul 2026) | 202 |
| 5.2 | Wait 5s, get run detail | Shows status + employee count |
| 5.3 | List salary slips | ≥1 slip generated |
| 5.4 | **Govt employee slip** | Components: Basic + DA(50%) + HRA(24%) + TA; Deductions: NPS(10%) + PT + TDS |
| 5.5 | **Contract employee slip** | Components: Basic(40%CTC) + HRA + Special; Deductions: EPF(12% on ₹15K cap) + PT + TDS |
| 5.6 | **Intern slip** | Stipend only, minimal deductions |
| 5.7 | **Volunteer** | Should NOT generate a slip (eligibleForPayroll=false) |
| 5.8 | **Loan EMI deduction** | Active loan's EMI appears as LOAN_EMI deduction |
| 5.9 | **Protected-net-floor** | If EMI would breach floor, partial recovery + carryforward |
| 5.10 | **DA rate correctness** | DA=50% of basic (Jan 2024 revision) |
| 5.11 | **HRA city class** | X-city=24%, Y=16%, Z=8% |
| 5.12 | **EPF wage ceiling** | EPF computed on min(basic, ₹15,000) |
| 5.13 | **ESI threshold** | ESI only if gross ≤ ₹21,000 |
| 5.14 | **TDS new regime slabs** | Verify monthly TDS matches: (annual_taxable - 3L) × slab% / 12 |
| 5.15 | **Duplicate run for same month** | Should warn/prevent (no double payment) |

---

## SECTION 6: LOANS & ADVANCES (10 tests)

| # | Test | Expected |
|---|------|----------|
| 6.1 | Create HBA (₹25L, 180 EMIs, 7.5%) | 201, EMI auto-computed |
| 6.2 | Create Computer Advance (₹1L, 24 EMIs, 0%) | 201, interest-free |
| 6.3 | Create Salary Advance (₹50K, 5mo) | 201, status=pending |
| 6.4 | Approve salary advance | status→active |
| 6.5 | Pay 1 EMI on computer loan | Outstanding decreases by EMI, emisPaid++ |
| 6.6 | Pay all remaining EMIs | status→completed (auto-close) |
| 6.7 | **Zero EMI count** | 400 validation (must be positive) |
| 6.8 | **Negative amount** | 400 validation |
| 6.9 | List loans (verify outstanding tracking) | Correct math across multiple EMI payments |
| 6.10 | **Idempotent EMI payment** | Paying same EMI twice should not double-debit |

---

## SECTION 7: RECRUITMENT LIFECYCLE (12 tests)

| # | Test | Expected |
|---|------|----------|
| 7.1 | Create vacancy (regular, published) | 202 |
| 7.2 | Create vacancy (internship, published) | 202 |
| 7.3 | Create vacancy (NOT published) | 202 |
| 7.4 | Public list (NO AUTH) | Only published vacancies visible |
| 7.5 | Unpublished NOT in public list | Verify |
| 7.6 | Public application | 201 `{ status: "received" }` |
| 7.7 | Application to closed vacancy | 404 "not accepting applications" |
| 7.8 | Talent pool search by skill | Returns applicant |
| 7.9 | Talent pool filter by minExp | Filters correctly |
| 7.10 | Schedule interview | 202 |
| 7.11 | Hire applicant → creates employee | 202 + employee appears in list |
| 7.12 | Recruitment dashboard stats | Correct counts |

---

## SECTION 8: MULTI-TENANT ISOLATION (10 tests) — SECURITY CRITICAL

| # | Test | Expected |
|---|------|----------|
| 8.1 | Create tenant B | 202 |
| 8.2 | Create employee in tenant B | 202 |
| 8.3 | List employees with tenant A token | Should NOT see tenant B employee |
| 8.4 | List employees with tenant B token | Should see ONLY tenant B employee |
| 8.5 | Get tenant B employee with tenant A token | 404 or 403 (not visible) |
| 8.6 | Apply leave in tenant A for tenant B employee | Should FAIL |
| 8.7 | Public career listing tenant A | Only tenant A vacancies |
| 8.8 | Sample data in tenant A | Does NOT appear in tenant B |
| 8.9 | Loans in tenant A not visible to B | Verify |
| 8.10 | **Cross-tenant token swap** | Mint token for A, try to act as B → denied |

---

## SECTION 9: IDEMPOTENCY & CQRS CONSISTENCY (8 tests)

| # | Test | Expected |
|---|------|----------|
| 9.1 | Submit same employee twice (same messageId) | Only one created (inbox dedup) |
| 9.2 | Submit same leave application twice | Only one processed |
| 9.3 | Read immediately after write (before consumer) | Cache shows projected view (202→cache) |
| 9.4 | Read after consumer processes | Persistent view matches |
| 9.5 | Publish same command with same correlationId | Deduped |
| 9.6 | **Consumer crash recovery** | Kill worker, restart → pending messages reprocessed |
| 9.7 | **Outbox relay** | Write + event → verify event appears in audit within 10s |
| 9.8 | **Cache invalidation** | After write, subsequent read reflects new data (not stale cache) |

---

## SECTION 10: PERFORMANCE SLA (10 tests)

Target: p95 < 200ms for reads, p95 < 500ms for writes (excluding CQRS consumer time).

| # | Test | SLA |
|---|------|-----|
| 10.1 | GET /employees (50 rows) | <200ms |
| 10.2 | GET /leave-policies | <100ms |
| 10.3 | GET /payroll/structures | <100ms |
| 10.4 | POST /employees (single) | <500ms |
| 10.5 | POST /leave-applications | <300ms |
| 10.6 | GET /talent-pool (search) | <300ms |
| 10.7 | GET /recruitment/dashboard | <200ms |
| 10.8 | GET /hrms/loans (10 rows) | <150ms |
| 10.9 | POST /careers/apply (public, no auth) | <400ms |
| 10.10 | GET /careers/vacancies (public) | <200ms |

Run each 5 times, report p50 and p95.

---

## SECTION 11: STATUTORY COMPLIANCE (8 tests)

Indian labour law + CCS rules that MUST be enforced.

| # | Statute | Test | Expected |
|---|---------|------|----------|
| 11.1 | EPF Act 1952 | EPF deducted on Basic capped at ₹15,000 | emiMinor = min(basic,15000) × 12% |
| 11.2 | ESI Act 1948 | ESI only if monthly gross ≤ ₹21,000 | No ESI for ₹50K+ employees |
| 11.3 | CCS Leave Rules | Sandwich rule for CL | Days count correctly |
| 11.4 | CCS Leave Rules | EL accumulation cap 300 days | Warned if exceeding |
| 11.5 | GFR Rule 230 | Advance overdue tracking | Advances past due date show "overdue" |
| 11.6 | Payment of Gratuity Act | Gratuity provisioned at 4.81% | Part of employer cost |
| 11.7 | Income Tax Act Sec 192 | Monthly TDS under new regime | Correct slab application |
| 11.8 | Maternity Benefit Act | 180 days for women, 2 pregnancies max | Rules enforced |

---

## SECTION 12: GPF / NPS / PENSION (8 tests)

| # | Test | Expected |
|---|------|----------|
| 12.1 | GPF account creation | Account exists for GPF-eligible employee |
| 12.2 | GPF contribution (credit) | Balance increases |
| 12.3 | GPF advance (debit) | Balance decreases, logged in ledger |
| 12.4 | GPF advance exceeding balance | Should FAIL |
| 12.5 | GPF interest accrual | Credit with type "interest" |
| 12.6 | NPS contribution record | Monthly employer 14% + employee 10% |
| 12.7 | Pensioner PPO | List pensioners |
| 12.8 | Pension calculation | Based on last 10 months average basic |

---

## SECTION 13: ERROR HANDLING & RESILIENCE (12 tests)

Every error MUST return a clean JSON envelope — never raw text, never HTML, never stack traces.

| # | Test | Expected |
|---|------|----------|
| 13.1 | No auth token | 401 `{ code: "UNAUTHENTICATED" }` |
| 13.2 | Expired token | 401 |
| 13.3 | Malformed JSON body | 400 `{ code: "VALIDATION_FAILED" }` |
| 13.4 | Empty body on POST | 400 |
| 13.5 | Non-existent endpoint | 404 clean JSON |
| 13.6 | Non-existent resource ID | 404 `{ code: "NOT_FOUND" }` |
| 13.7 | Invalid UUID format | 400 |
| 13.8 | Very long string (10KB name) | 400 (max length validation) |
| 13.9 | SQL injection attempt in query param | No crash, no data leak |
| 13.10 | XSS in applicant name | Stored safely, rendered escaped |
| 13.11 | Request with wrong content-type | 400 or 415 |
| 13.12 | **Response never contains stack trace** | Scan all error responses for "at " patterns |

---

## FINAL SCORING

| Section | Weight | Description |
|---------|--------|-------------|
| 1. Master Data | 5% | Foundation |
| 2. Employee Onboarding | 10% | Core lifecycle |
| 3. Leave Rules | 15% | Most complex business logic |
| 4. Attendance | 5% | Daily operations |
| 5. Payroll | 15% | Money — must be correct |
| 6. Loans | 5% | Financial tracking |
| 7. Recruitment | 10% | Full lifecycle |
| 8. Multi-Tenant | 15% | Security — non-negotiable |
| 9. Idempotency | 10% | Data integrity |
| 10. Performance | 5% | User experience |
| 11. Statutory | 5% | Legal compliance |
| 12. GPF/NPS | 3% | Pension |
| 13. Error Handling | 7% | Production-readiness |

**Production deployment gate:** Sections 3, 5, 8, 13 must be 100%. Others ≥80%.

---

## TOTAL: 147 TEST CASES

Execute all. Report honestly. No partial passes — either the assertion holds or it doesn't.
