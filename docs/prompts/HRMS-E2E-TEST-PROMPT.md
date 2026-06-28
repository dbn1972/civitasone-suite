# HRMS End-to-End Test Prompt

> Use this prompt with any AI coding agent (Kiro, Claude, Cursor, etc.) to perform a comprehensive end-to-end test of the CivitasOne HRMS module against live services.

---

## PROMPT

```
You are a senior QA automation engineer testing the CivitasOne HRMS module end-to-end against live services on a UAT environment. The gateway is at http://localhost:8080. Authentication uses HS256 dev tokens.

Your mission: test EVERY HRMS use case systematically — from employee onboarding to retirement — proving each API endpoint works correctly, data flows between modules, business rules are enforced, and edge cases are handled.

## ENVIRONMENT SETUP

1. Mint a dev token:
   ```javascript
   const { createHmac } = require("node:crypto");
   const SECRET = "civitasone-dev-secret";
   const TENANT = "00000000-0000-0000-0000-000000000001";
   const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
   const now = Math.floor(Date.now() / 1000);
   const header = b64({ alg: "HS256", typ: "JWT" });
   const payload = b64({ sub: "00000000-0000-0000-0000-000000000099", iss: "civitasone-dev", tid: TENANT, tenantId: TENANT, sid: "e2e-test", roles: ["super_admin","hr_admin","finance_admin","payroll_admin"], iat: now, exp: now + 7200 });
   const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
   const TOKEN = `${header}.${payload}.${sig}`;
   ```

2. All API calls use: `Authorization: Bearer ${TOKEN}` and `Content-Type: application/json`
3. Gateway base: `http://localhost:8080`
4. Expected response pattern: 200 for reads, 201/202 for writes, error envelope `{ code, message, correlationId }`

## TEST PLAN — Execute each section in order. Report PASS/FAIL per test.

---

### SECTION 1: MASTER DATA CONFIGURATION

Test the foundational setup that must exist before any HR operation.

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 1.1 | List departments | GET | /api/v1/hrms/departments | 200 + array of departments |
| 1.2 | Create a new department | POST | /api/v1/hrms/departments | 201 `{ id, status: "created" }` |
| 1.3 | List designations | GET | /api/v1/hrms/designations | 200 + array |
| 1.4 | Create designation with pay level | POST | /api/v1/hrms/designations | 201 |
| 1.5 | List employee types | GET | /api/v1/hrms/employee-types | 200 + types with config flags |
| 1.6 | Create custom employee type | POST | /api/v1/hrms/employee-types | 201 |
| 1.7 | List leave types | GET | /api/v1/hrms/leave-types | 200 + at least CL, EL, HPL, MED |
| 1.8 | Create leave type | POST | /api/v1/hrms/leave-types | 202 accepted |
| 1.9 | List leave policies | GET | /api/v1/hrms/admin/leave-policies | 200 + policies per employee type |
| 1.10 | Create leave policy (intern CL 4d) | POST | /api/v1/hrms/admin/leave-policies | 201 |
| 1.11 | List holidays | GET | /api/v1/hrms/holidays | 200 + gazetted holidays |
| 1.12 | Create holiday | POST | /api/v1/hrms/holidays | 202 |
| 1.13 | List payroll structures | GET | /api/v1/payroll/structures | 200 |
| 1.14 | List shifts | GET | /api/v1/hrms/shifts | 200 |

**Validate:** All master data endpoints respond. Leave policies exist for permanent, contractual, deputation, intern, apprentice, volunteer, consultant.

---

### SECTION 2: EMPLOYEE LIFECYCLE — ONBOARDING TO CONFIRMATION

| # | Test Case | Method | Endpoint | Body/Params | Expected |
|---|-----------|--------|----------|-------------|----------|
| 2.1 | Create permanent employee | POST | /api/v1/hrms/employees | `{ employeeNo: "E2E-001", fullName: "Test Permanent Employee", departmentId: "<dept_id>", designationId: "<desig_id>", employeeType: "permanent", dateOfJoining: "2024-01-15", basicMinor: 5610000, currency: "INR" }` | 202 accepted |
| 2.2 | Create contractual employee | POST | /api/v1/hrms/employees | `{ employeeNo: "E2E-002", ..., employeeType: "contract", basicMinor: 8000000 }` | 202 |
| 2.3 | Create intern | POST | /api/v1/hrms/employees | `{ employeeNo: "E2E-003", ..., employeeType: "intern", basicMinor: 1500000 }` | 202 |
| 2.4 | Wait for CQRS (5s), then list employees | GET | /api/v1/hrms/employees?limit=50 | 200 + all 3 new employees visible |
| 2.5 | Get employee detail | GET | /api/v1/hrms/employees/:id | 200 + full profile |
| 2.6 | Verify employee types in list | GET | /api/v1/hrms/employees | Check: employeeType field shows permanent/contract/intern |
| 2.7 | Confirm probation (permanent) | PATCH | /api/v1/hrms/employees/:id/confirm | `{ confirmationDate: "2025-01-15" }` | 202 |

**Validate:** All employee types create successfully. CQRS consumer persists within 5s. Employee types and pay are correctly stored and returned.

---

### SECTION 3: LEAVE MANAGEMENT (Full CCS Rules Engine)

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 3.1 | Allocate CL to permanent employee | POST | /api/v1/hrms/leave-allocations | `{ employeeId, leaveTypeId: "<CL_ID>", fy: "2026-27", totalDays: 8 }` → 202 |
| 3.2 | Wait 3s, then apply 1 day CL | POST | /api/v1/hrms/leave-applications | `{ employeeId, leaveTypeId, allocId, fromDate, toDate, daysApplied: 1 }` → 202 |
| 3.3 | Apply leave exceeding balance (9 days) | POST | /api/v1/hrms/leave-applications | → 422 LEAVE_RULE_VIOLATION "Insufficient balance" |
| 3.4 | Apply EL during probation | POST | /api/v1/hrms/leave-applications | → 422 "Only Casual Leave allowed during probation" |
| 3.5 | Apply Maternity Leave for male employee | POST | /api/v1/hrms/leave-applications | → 422 "Maternity Leave is for women employees only" |
| 3.6 | Apply leave for intern (should use intern policy — max 4d CL) | POST | /api/v1/hrms/leave-applications | Validates against intern policy limits |
| 3.7 | Verify sandwich rule enforcement | POST | /api/v1/hrms/leave-applications | CL spanning a weekend → warning about sandwich rule |
| 3.8 | List leave applications | GET | /api/v1/hrms/leave-applications | 200 + submitted applications visible |
| 3.9 | Approve a leave application | PATCH | /api/v1/hrms/leave-applications/:id/approve | 202 |
| 3.10 | Reject a leave application | PATCH | /api/v1/hrms/leave-applications/:id/reject | `{ reason: "..." }` → 202 |

**Validate:** The rules engine enforces: balance check, probation restriction, gender check, employee-type eligibility, sandwich rule, prefix/suffix rule, max continuous days. All per the CCS Leave Rules.

---

### SECTION 4: ATTENDANCE

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 4.1 | List attendance (today) | GET | /api/v1/hrms/attendance | 200 |
| 4.2 | Record check-in | POST | /api/v1/hrms/attendance/checkin | 202 |
| 4.3 | List regularisation requests | GET | /api/v1/hrms/attendance/regularisation | 200 |
| 4.4 | Submit regularisation | POST | /api/v1/hrms/attendance/regularisation | 202 |

---

### SECTION 5: PAYROLL

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 5.1 | Create payroll run | POST | /api/v1/payroll/runs | `{ runNo, month: "2026-07", structureId }` → 202 |
| 5.2 | Wait 5s, list payroll runs | GET | /api/v1/payroll/runs | Shows new run |
| 5.3 | Get payroll run detail | GET | /api/v1/payroll/runs/:id | Full detail with employee count |
| 5.4 | List salary slips | GET | /api/v1/payroll/salary-slips | Generated slips |
| 5.5 | Get individual slip | GET | /api/v1/payroll/slips/:id | Components breakdown (Basic, DA, HRA, NPS, TDS etc.) |
| 5.6 | Verify slip has correct components for govt employee | | | Basic + DA 50% + HRA 24% + NPS 10% deduction |
| 5.7 | Verify slip for contractual (no DA, no NPS) | | | Basic + HRA + Special allowance - EPF - PT - TDS |

---

### SECTION 6: LOANS & ADVANCES

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 6.1 | Create HBA loan | POST | /api/v1/hrms/loans | `{ employeeId, loanType: "hba", sanctionedAmountMinor: 2500000000, totalEmis: 180, interestRateBps: 750, sanctionDate }` → 201 |
| 6.2 | Create salary advance | POST | /api/v1/hrms/salary-advances | `{ employeeId, amountMinor: 5000000, purpose: "Medical", recoveryMonths: 5 }` → 201 |
| 6.3 | Approve advance | PATCH | /api/v1/hrms/salary-advances/:id/approve | 200 status → "approved" |
| 6.4 | Pay one EMI | PATCH | /api/v1/hrms/loans/:id/emi-paid | Outstanding decreases by EMI amount |
| 6.5 | List loans | GET | /api/v1/hrms/loans | Shows correct outstanding, EMIs paid |
| 6.6 | List advances | GET | /api/v1/hrms/salary-advances | Shows approved advance with EMI computed |

---

### SECTION 7: RECRUITMENT & TALENT POOL

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 7.1 | Create published vacancy (internship) | POST | /api/v1/hrms/job-openings | `{ ..., vacancyType: "internship", isPublished: true }` → 202 |
| 7.2 | Wait 5s, list public vacancies (NO AUTH) | GET | /api/v1/careers/vacancies | Header: x-tenant-id only → 200 + published vacancy visible |
| 7.3 | Submit public application (NO AUTH) | POST | /api/v1/careers/apply | `{ jobOpeningId, applicantName, email, skills }` → 201 |
| 7.4 | Wait 5s, search talent pool | GET | /api/v1/hrms/talent-pool?skill=<skill> | 200 + applicant visible with skills |
| 7.5 | Get recruitment dashboard | GET | /api/v1/hrms/recruitment/dashboard | 200 + counts (openings, published, applications) |
| 7.6 | Schedule interview | POST | /api/v1/hrms/interviews | 202 |
| 7.7 | Hire applicant | POST | /api/v1/hrms/applications/:id/hire | `{ employeeNo, dateOfJoining, basicMinor, departmentId, designationId, employeeType }` → 202 |

**Validate:** Full recruitment lifecycle: publish vacancy → external candidate applies without login → HR searches talent pool → interview → hire → employee created.

---

### SECTION 8: PERFORMANCE (APAR)

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 8.1 | List appraisal cycles | GET | /api/v1/hrms/appraisals | 200 |
| 8.2 | Create new appraisal | POST | /api/v1/hrms/appraisals | 202 |
| 8.3 | List goals/KRAs | GET | /api/v1/hrms/goals | 200 |

---

### SECTION 9: EMPLOYEE LIFECYCLE EVENTS

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 9.1 | Transfer order | POST/GET | /api/v1/hrms/transfers | 200 (list) |
| 9.2 | Promotion order | POST/GET | /api/v1/hrms/promotions | 200 |
| 9.3 | Deputation | POST/GET | /api/v1/hrms/deputation | 200 |
| 9.4 | Service book | GET | /api/v1/hrms/service-book | 200 + history entries |
| 9.5 | Retirement queue | GET | /api/v1/hrms/retirements | 200 |

---

### SECTION 10: GPF / NPS / PENSION

| # | Test Case | Method | Endpoint | Expected |
|---|-----------|--------|----------|----------|
| 10.1 | GPF account balance | GET | /api/v1/hrms/employees/:id/gpf | 200 + balance |
| 10.2 | GPF advance (withdrawal) | POST | /api/v1/hrms/employees/:id/gpf/advance | 202 + balance decreases |
| 10.3 | GPF contribution (credit) | POST | /api/v1/hrms/employees/:id/gpf/contribution | 202 + balance increases |
| 10.4 | NPS contributions | GET | /api/v1/payroll/nps/:employeeId | 200 |
| 10.5 | Pensioner list | GET | /api/v1/payroll/pensioners | 200 |

---

### SECTION 11: CROSS-MODULE INTEGRATION

| # | Test Case | What to verify |
|---|-----------|----------------|
| 11.1 | Hire creates employee + payroll picks up | After hire via recruitment, employee appears in employees list AND can run payroll |
| 11.2 | Leave affects attendance | Approved leave shows as "on leave" in attendance |
| 11.3 | Loan EMI in payroll | Active loan's EMI deducted in salary computation (LOAN_EMI code) with protected-net-floor |
| 11.4 | Salary advance recovery | Approved advance's EMI deducted monthly |
| 11.5 | GPF contribution from payroll | Monthly payroll run credits GPF account |
| 11.6 | Audit trail | Every write operation emits an audit event → visible in /api/audit/events |

---

### SECTION 12: EDGE CASES & ERROR HANDLING

| # | Test Case | Expected Behaviour |
|---|-----------|-------------------|
| 12.1 | Create employee with duplicate employeeNo | 409 or appropriate error — not a crash |
| 12.2 | Apply leave with invalid dates (toDate < fromDate) | 400 validation error |
| 12.3 | Apply leave for non-existent employee | 404 EMP_NOT_FOUND |
| 12.4 | Apply leave for non-existent allocation | 404 ALLOC_NOT_FOUND |
| 12.5 | Create loan with 0 EMIs | 400 validation (totalEmis must be positive) |
| 12.6 | Hire with invalid employee type | 400 validation |
| 12.7 | Access another tenant's data | 403 FORBIDDEN or empty result (RLS) |
| 12.8 | Request without auth token | 401 UNAUTHENTICATED |
| 12.9 | Request with expired token | 401 |
| 12.10 | Create employee with future joining date | Should succeed (pre-boarding) |

---

## EXECUTION INSTRUCTIONS

1. Run each section sequentially (later sections depend on data from earlier ones).
2. Wait for CQRS consumers between write + read (3-5 seconds per the architecture).
3. Report results as:
   ```
   SECTION X: [PASS/FAIL] — N/M tests passed
     ❌ X.Y: <description of failure + actual response>
   ```
4. After all sections, produce:
   - **Total: X/Y passed**
   - **Critical failures** (block production deployment)
   - **Non-critical** (degraded but functional)
   - **Recommendations** (what to fix first)

## SUCCESS CRITERIA

- All Section 1-3 tests MUST pass (master data + employees + leave rules = core)
- Section 7 (recruitment lifecycle) MUST pass end-to-end
- Section 12 error handling MUST not produce 500s (all errors are handled gracefully)
- Cross-module integration (Section 11) validates the CQRS architecture actually works

Good luck. Be thorough. Report honestly.
```

---

## HOW TO USE THIS PROMPT

1. Open a new AI agent session (Kiro, Claude Code, Cursor, etc.)
2. Paste the prompt above
3. The agent will systematically execute every test case against the live services
4. Review the report for any failures
5. Fix failures → re-run → iterate to 100%

This prompt tests **87 use cases** across the full HRMS lifecycle:
- 14 master data tests
- 7 employee lifecycle tests  
- 10 leave management tests (with rules engine validation)
- 4 attendance tests
- 7 payroll tests
- 6 loan/advance tests
- 7 recruitment tests
- 3 performance tests
- 5 lifecycle event tests
- 5 GPF/NPS/pension tests
- 6 cross-module integration tests
- 10 edge case/error handling tests
- **= 84 test cases total**
