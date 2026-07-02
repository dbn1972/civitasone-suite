# Coverage Sprint Prompt — Reach 80% Across All Core Modules

Copy this prompt into a fresh AI session. It will work iteratively, module by module, until 80% is achieved.

---

```text
You are a senior QA engineer working on CivitasOne ERP at /home/ec2-user/CivitasOne/civitasone-suite.

Your ONLY goal: raise test coverage to 80%+ lines for the core modules of these services:
- hrms-service (currently 63.8%)
- finance-service (currently 61.4%)
- payroll-service (currently ~45%)
- estab-service (currently 55%)
- workflow-service (currently 63%)

## METHOD (iterate until 80%)

For EACH service, repeat this loop:

### Step 1: Identify lowest-coverage files
```bash
pnpm --filter @civitasone/<service> exec vitest run --coverage 2>&1 | grep -E "\.ts\s" | awk -F'|' '{print $2"% "$1}' | sort -n | head -10
```

### Step 2: Read the lowest file
Read the source file completely. Understand every function, branch, and error path.

### Step 3: Write tests targeting uncovered lines
Create a test file: `services/<service>/tests/<module>-coverage.test.ts`

Test patterns:
- For domain.ts: unit test every exported function with valid + invalid inputs
- For consumer.ts: use MemoryQueue + real DB, publish commands, verify DB state + outbox events + idempotency
- For routes.ts: use buildApp() + inject() with HS256 JWT (JWT_SECRET=test_secret_for_civitasone_32chr)
- For repo.ts: seed data, call repo functions, assert results
- For queries.ts: seed data, call query functions, assert cached/DB results

### Step 4: Run and verify
```bash
pnpm --filter @civitasone/<service> test
```
ALL tests must pass. If any fail, fix them before moving on.

### Step 5: Measure coverage
```bash
pnpm --filter @civitasone/<service> exec vitest run --coverage 2>&1 | grep "All files"
```
If below 80%, go back to Step 1 and target the next lowest file.

### Step 6: Commit when a module reaches 80%
```bash
git add services/<service>/tests/ && git commit -m "test(<service>): coverage sprint — <module> at 80%+"
git push origin feat/full-remediation-wave-2026-06-27
```

## SERVICE-SPECIFIC GUIDANCE

### HRMS (63.8% → 80%)
Priority modules to test (in order):
1. `src/modules/leave/` — CCS Leave Rules: EL 15d/yr, HPL 10d, carry-forward 300d max, no negative balance
2. `src/modules/gpf/` — GPF interest 7.1% compounded monthly, withdrawal rules (Rule 15/16)
3. `src/modules/pension/` — Commutation (table-based), family pension (30%→15%), DCRG
4. `src/modules/disciplinary/` — Rule 14 inquiry timeline (15d response), suspension, reinstatement
5. `src/modules/attendance/` — LOP calculation, regularisation approval, late-marks → half-day
6. `src/modules/deputation/` — Deputation allowance, cadre return, extension rules
7. `src/modules/claims/` — LTC (one hometown + all-India per block), CEA ceiling per child
8. `src/modules/recruitment/` — Job opening → publish → applications → shortlist → interview → hire
9. `src/modules/training/` — Nomination → approval → completion → feedback

### FINANCE (61.4% → 80%)
Priority modules:
1. `src/modules/budget/` — Allocation, reappropriation, surrender, lapse computation
2. `src/modules/gl/` — Journal posting, reversal, period-close block, trial balance
3. `src/modules/payments/` — Bill create/approve, 3-way match, payment initiation
4. `src/modules/treasury/` — Challan, deposit, refund, forfeit lifecycle
5. `src/modules/bank-recon/` — Statement import, auto-match, manual match
6. `src/modules/period-close/` — Soft-close, hard-close, re-open logic
7. `src/modules/recurring/` — Recurring journal auto-posting
8. `src/modules/hoa/` — Head of Account validation, gapless voucher numbering

### PAYROLL (45% → 80%)
Priority modules:
1. `src/modules/payroll/domain.ts` — Gross/net computation, statutory deduction
2. `src/modules/tax/` — Income tax slab (old/new regime), 80C/80D/80E, surcharge
3. `src/modules/statutory/` — PF (12% employer + 12% employee on ₹15K ceiling), ESI (0.75%+3.25% on ₹21K), NPS (14%+10%)
4. `src/modules/loans/` — EMI computation, outstanding balance, pre-closure
5. `src/modules/payroll/consumer.ts` — Run create → compute → approve → disburse lifecycle

### ESTAB (55% → 80%)
Priority modules:
1. `src/modules/files/consumer.ts` — Error paths (file not found, closed-file guard, classification deny)
2. `src/modules/dfa/consumer.ts` — Maker-checker violation, version snapshot on return
3. `src/modules/records/` — Record-room transfer, requisition, archival, NAI transfer
4. `src/modules/correspondence/` — Page numbering, PUC mark/unmark
5. `src/modules/operators/` — Eligibility check, clearance level gate

### WORKFLOW (63% → 80%)
Priority modules:
1. `src/modules/instances/commands.ts` — Cancel, suspend, resume state machine
2. `src/modules/tasks/consumer.ts` — SoD enforcement, parallel branch join, timer fire
3. `src/modules/provisioning/consumer.ts` — Tenant.created → seed definitions
4. `src/modules/assignment/resolver.ts` — Round-robin, role-based, load-balanced assignment

## RULES

1. NEVER modify existing test files (only create new ones)
2. NEVER modify source code to make tests pass (fix tests, not source)
3. Each test file name: `<module>-domain.test.ts`, `<module>-consumer.test.ts`, or `<module>-routes.test.ts`
4. Use valid hex UUIDs only (no letters g-z in uuid segments)
5. Use `afterAll` to close DB connections (prevent hanging)
6. Use `beforeEach` to clean test data (tenant-scoped deletes)
7. Money values are bigint paise (never float): `3000000n` = ₹30,000
8. The HS256 bypass: `JWT_ALGORITHM=HS256`, `JWT_SECRET=test_secret_for_civitasone_32chr`
9. Queue in tests: `import { MemoryQueue } from "@civitasone/queue"`
10. DB connection: `import { db, sqlClient } from "../src/shared/db.js"`

## STOP CONDITION

Stop when ALL of these are true:
- hrms-service: ≥80% lines
- finance-service: ≥80% lines  
- payroll-service: ≥80% lines
- estab-service: ≥80% lines
- workflow-service: ≥80% lines

Then run the full 32-service suite to confirm zero regressions:
```bash
for svc in identity tenant policy audit notification finance procurement contract hrms payroll estab asset stock inventory project grant citizen legal crm helpdesk telephony knowledge location report analytics workflow admin billing install plugin queue gateway; do
  result=$(pnpm --filter "@civitasone/${svc}-service" test 2>&1)
  if echo "$result" | grep -q "failed"; then echo "❌ $svc FAILED"; fi
done
echo "✅ ALL GREEN"
```

Commit final state and report the coverage numbers.
```
