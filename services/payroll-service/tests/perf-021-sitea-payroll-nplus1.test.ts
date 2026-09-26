/**
 * PERF-021 (Site A) regression tests — payroll-service processPayrollRun.
 *
 * Covers docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's PERF-021 row, Site A:
 * payroll-service's processPayrollRun() issued ~9-12 sequential per-employee
 * round trips inside its single run-wide transaction. This fix batches 6 of
 * them — latest salary revision, LOP ledger, active loans, tax declaration,
 * TDS-YTD, and per-state PT slabs — into one query each for the WHOLE run,
 * via new *Tx sibling functions (resolveLatestRevisionsTx, lopRepo
 * .getLopForMonthsTx, loansRepo.findLoansByEmployeesTx, resolveDeclarationsTx,
 * resolveTdsYtdMinorsTx, resolvePtSlabsByStatesTx), all reading through the
 * caller's already-open outer tx (same deadlock-avoidance reasoning as the
 * *Tx singles they sit beside — see salary-revision-tenanttransaction-nested
 * -tx-deadlock.test.ts / lop-tenanttransaction-nested-tx-deadlock.test.ts in
 * this same directory).
 *
 * Deliberately NOT batched, for documented correctness reasons (see the PR
 * description): generateRetroArrears's own revision read (stays with its
 * write, per-employee, in-loop) and collectAdHocEarnings's 3 FOR UPDATE
 * reads (lock timing + the same-run-generated-arrears-must-be-collectible
 * -this-run ordering against generateRetroArrears are load-bearing). So
 * processPayrollRun's total query count still scales with employee count —
 * just with a much smaller per-employee slope than before.
 *
 * Section A: each of the 6 new batch functions proven O(1) directly — exactly
 * 1 query for 3 employees and for 20 — the same way resolveLatestRevision and
 * getLopForMonthTx got their own direct deadlock-regression tests in this
 * same directory. This includes loansRepo.findLoansByEmployeesTx, proven
 * correct and O(1) directly at the repo layer (Section B deliberately does
 * NOT drive a loan through the full end-to-end path -- see its own note).
 *
 * Section B: an end-to-end run through the REAL queue consumer
 * (registerPayrollConsumers + COMMANDS.runCreate), proving byte-identical
 * results for every value the OTHER 5 batched reads feed into a slip:
 *   - P2: Basic sourced from the salary revision, not the HRMS fallback.
 *   - P2 + P1/C2 ordering: the retro arrear generateRetroArrears creates THIS
 *     run is collected and marked paid in this SAME run (proves the
 *     collectAdHocEarnings ordering dependency was not broken by hoisting
 *     the revision read).
 *   - M2: the LOP ledger (2 days) wins over the HRMS feed (10 days).
 *   - H14: two employees in different states get different PT withheld from
 *     the SAME batched per-state fetch.
 * …and that the per-employee query-cost delta between a small and a large
 * run is small and bounded — not the ~18 round trips/employee the unfixed
 * code would show in this same scenario (6 batched sites + ~12 still-
 * genuinely-per-employee round trips: generateRetroArrears's read+insert,
 * collectAdHocEarnings's 3 reads, computeAndInsertSlip's ~3 writes, the loan
 * -repayment read+2 writes, and the arrears double-pay-guard update).
 *
 * NOT exercised end-to-end here: a "disbursed" loan with a positive applied
 * EMI. Doing so hits a real, pre-existing, unrelated bug -- loansRepo
 * .insertRepayment writes status: "paid", but payroll_loan_repayments
 * _status_check (migration 0027) only allows pending/deducted/waived/
 * overdue, so the INSERT throws and rolls back the whole run. Flagged as a
 * separate follow-up (not this PR's concern); loansRepo.findLoansByEmployeesTx
 * itself is proven correct and O(1) directly in Section A above.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollLopLedger } from "../src/modules/integration/schema.js";
import { payrollLoans } from "../src/modules/loans/schema.js";
import { payrollTds } from "../src/modules/statutory/schema.js";
import * as lopRepo from "../src/modules/integration/lop-repo.js";
import * as loansRepo from "../src/modules/loans/repo.js";
import {
  registerPayrollConsumers,
  resolveLatestRevisionsTx,
  resolveDeclarationsTx,
  resolveTdsYtdMinorsTx,
  resolvePtSlabsByStatesTx,
} from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "91000000-0000-4021-8000-0000000000a1";
const RUN_MONTH = "2026-09";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

afterAll(async () => { await sqlClient.end(); });

function makeEmployeeIds(n: number): string[] {
  return Array.from({ length: n }, () => randomUUID());
}

// ─── Section A: each new batch function is O(1), not O(N) ───────────────

describe("PERF-021 (Site A) — batch-loader functions are O(1) in employee count", () => {
  it("resolveLatestRevisionsTx: 1 query for 3 employees, 1 query for 20; values match per-employee input", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      const ids = makeEmployeeIds(n);
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          await tx.execute(sql`
            INSERT INTO payroll.payroll_salary_revisions
              (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor)
            VALUES (${tenant}::uuid, ${ids[i]}::uuid, '2026-08-01'::date, 2500000, ${3500000 + i}, 4000000, 5000000)
          `);
        }
      }));
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) =>
          resolveLatestRevisionsTx(tx as unknown as typeof db, tenant, ids, RUN_MONTH))));
      return { ids, result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    expect(small.result.size).toBe(3);
    expect(large.result.size).toBe(20);
    large.ids.forEach((id, i) => {
      expect(large.result.get(id)?.newBasicMinor).toBe(BigInt(3500000 + i));
    });
    // A miss (employee with no revision) is absent, not a crash.
    expect(large.result.get(randomUUID())).toBeUndefined();
  });

  it("lopRepo.getLopForMonthsTx: 1 query regardless of N; a miss defaults like getLopForMonthTx's no-rows case", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      const ids = makeEmployeeIds(n);
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          await tx.insert(payrollLopLedger).values({ tenantId: tenant, employeeId: ids[i], month: RUN_MONTH, lopDays: i + 1, source: "test" });
        }
      }));
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) => lopRepo.getLopForMonthsTx(tx, tenant, ids, RUN_MONTH))));
      return { ids, result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    large.ids.forEach((id, i) => {
      expect(large.result.get(id)).toEqual({ hasLedger: true, days: i + 1 });
    });
    expect(large.result.get(randomUUID())).toBeUndefined(); // caller defaults to { hasLedger:false, days:0 }
  });

  it("loansRepo.findLoansByEmployeesTx: 1 query regardless of N; groups correctly per employee", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      const ids = makeEmployeeIds(n);
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          await tx.insert(payrollLoans).values({
            id: randomUUID(), tenantId: tenant, loanNo: `L-${i}`, employeeId: ids[i],
            loanType: "personal", principalMinor: 1200000n, outstandingMinor: BigInt(600000 + i),
            emiMinor: 50000n, tenureMonths: 24, interestRatePct: "12.00",
            status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
          });
        }
      }));
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) => loansRepo.findLoansByEmployeesTx(tx, tenant, ids))));
      return { ids, result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    large.ids.forEach((id, i) => {
      const loans = large.result.get(id);
      expect(loans).toHaveLength(1);
      expect(loans?.[0]?.outstandingMinor).toBe(BigInt(600000 + i));
    });
    expect(large.result.get(randomUUID())).toBeUndefined();
  });

  it("resolveDeclarationsTx: 1 query regardless of N; picks the latest declaration per employee like resolveDeclaration", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      const ids = makeEmployeeIds(n);
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        for (let i = 0; i < ids.length; i++) {
          // payroll_tax_declarations has UNIQUE(tenant_id, employee_id, fy) --
          // exactly one row can exist per employee+FY, so this is the only
          // row DISTINCT ON (employee_id) has to pick for each employee.
          await tx.execute(sql`
            INSERT INTO payroll.payroll_tax_declarations (tenant_id, employee_id, fy, regime, section_80c, section_80d, other_deductions, created_by, created_at)
            VALUES (${tenant}::uuid, ${ids[i]}::uuid, '2026-27', 'old', ${100000 + i}, 50000, 0, ${ACTOR}::uuid, NOW())
          `);
        }
      }));
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) =>
          resolveDeclarationsTx(tx as unknown as typeof db, tenant, ids, "2026-27"))));
      return { ids, result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    large.ids.forEach((id, i) => {
      const decl = large.result.get(id);
      expect(decl?.regime).toBe("old");
      expect(decl?.ded80cMinor).toBe(BigInt(100000 + i));
    });
  });

  it("resolveTdsYtdMinorsTx: 1 query regardless of N; excludes non-approved/disbursed runs (M3)", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      const ids = makeEmployeeIds(n);
      const approvedRunId = randomUUID();
      const draftRunId = randomUUID();
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values([
          { id: approvedRunId, tenantId: tenant, runNo: `APR-${tenant.slice(0, 8)}`, month: "2026-06", structureId: randomUUID(), status: "approved", createdBy: ACTOR, updatedBy: ACTOR },
          { id: draftRunId, tenantId: tenant, runNo: `DFT-${tenant.slice(0, 8)}`, month: "2026-07", structureId: randomUUID(), status: "draft", createdBy: ACTOR, updatedBy: ACTOR },
        ]);
        for (let i = 0; i < ids.length; i++) {
          const approvedSlip = randomUUID();
          const draftSlip = randomUUID();
          await tx.insert(payrollSlips).values([
            { id: approvedSlip, tenantId: tenant, runId: approvedRunId, employeeId: ids[i], employeeNo: `E-${i}`, basicMinor: 3000000n, grossMinor: 5000000n, totalDeductionsMinor: 500000n, netPayMinor: 4500000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR },
            { id: draftSlip, tenantId: tenant, runId: draftRunId, employeeId: ids[i], employeeNo: `E-${i}`, basicMinor: 3000000n, grossMinor: 5000000n, totalDeductionsMinor: 500000n, netPayMinor: 4500000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR },
          ]);
          await tx.insert(payrollTds).values([
            { id: randomUUID(), tenantId: tenant, slipId: approvedSlip, employeeId: ids[i], runId: approvedRunId, annualBasicMinor: 36000000n, taxableMinor: 3000000n, tdsMinor: BigInt(500000 + i), period: "2026-06", createdBy: ACTOR, updatedBy: ACTOR },
            { id: randomUUID(), tenantId: tenant, slipId: draftSlip, employeeId: ids[i], runId: draftRunId, annualBasicMinor: 36000000n, taxableMinor: 3000000n, tdsMinor: 999999900n, period: "2026-07", createdBy: ACTOR, updatedBy: ACTOR },
          ]);
        }
      }));
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) =>
          resolveTdsYtdMinorsTx(tx as unknown as typeof db, tenant, ids, 2026, RUN_MONTH))));
      return { ids, result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    large.ids.forEach((id, i) => {
      // Only the approved run's TDS counts -- the draft run's 999999900n must not appear.
      expect(large.result.get(id)).toBe(BigInt(500000 + i));
    });
  });

  it("resolvePtSlabsByStatesTx: 1 query keyed by DISTINCT state count, not employee count", async () => {
    async function seedAndFetch(tenant: string, n: number) {
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, 'KA', 0, 999999999999, 20000)`);
        await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, 'MH', 0, 999999999999, 17500)`);
      }));
      // n employees all map to just these 2 distinct states -- the whole point being tested.
      void n;
      const { result, queryCount } = await countQueriesDuring(() =>
        runWithTenant(tenant, () => db.transaction((tx) =>
          resolvePtSlabsByStatesTx(tx as unknown as typeof db, tenant, ["KA", "MH"]))));
      return { result, queryCount };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedAndFetch(tenantSmall, 3);
    const large = await seedAndFetch(tenantLarge, 20);

    // O(1): identical round-trip count whether the run has 3 employees or
    // 20 -- countQueriesDuring also counts runWithTenant/db.transaction's
    // own BEGIN/tenant-GUC/COMMIT overhead (a small constant), so the
    // absolute number is not exactly "1", but it must not grow with N.
    expect(large.queryCount).toBe(small.queryCount);
    expect(large.queryCount).toBeLessThanOrEqual(6);
    expect(large.result.get("KA")?.[0]?.amount).toBe(20000n);
    expect(large.result.get("MH")?.[0]?.amount).toBe(17500n);
    expect(large.result.get("DL")).toBeUndefined(); // no rows for this state -> absent, not a fallback
  });
});

// ─── Section B: end-to-end processPayrollRun via the real queue consumer ──

describe("PERF-021 (Site A) — processPayrollRun end-to-end: correctness + bounded per-employee query cost", () => {
  const DEPT_ID = randomUUID();

  async function seedFixtures(tenant: string, n: number) {
    const employees = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(), employeeNo: `E-${i}`, fullName: `Employee ${i}`,
      basicMinor: "3000000", dateOfJoining: "2020-01-01",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
      cityClass: "X" as const, taxRegime: "new" as const, departmentId: DEPT_ID,
      pensionScheme: "NPS" as const, stateCode: i % 2 === 0 ? "KA" : "MH",
    }));

    const approvedRunId = randomUUID();
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, 'KA', 0, 999999999999, 20000)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, 'MH', 0, 999999999999, 17500)`);
      // resolveDaRateBps now rejects a run whose tenant/period has no DA rate
      // configured at all (DA_RATE_NOT_CONFIGURED) -- seed one so this
      // performance/correctness test's run reaches processPayrollRun's body
      // instead of failing fast on an unrelated configuration gap. The exact
      // rate doesn't matter to this test's assertions (LOP/PT/ARREAR are
      // basic- or table-driven, and ARREAR is checked for self-consistency
      // against payroll_arrears, not a hardcoded value).
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, '2026-01-01'::date, 5000)`);
      await tx.insert(payrollRuns).values({
        id: approvedRunId, tenantId: tenant, runNo: `PRIOR-${tenant.slice(0, 8)}`, month: "2026-06",
        structureId: randomUUID(), status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      });
      for (const e of employees) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_salary_revisions
            (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor)
          VALUES (${tenant}::uuid, ${e.id}::uuid, '2026-08-01'::date, 2500000, 3500000, 4000000, 5000000)
        `);
        await tx.insert(payrollLopLedger).values({ tenantId: tenant, employeeId: e.id, month: RUN_MONTH, lopDays: 2, source: "attendance_sync" });
        // NOTE: deliberately not exercising a "disbursed" loan with a positive
        // EMI through this end-to-end path -- doing so hits a real,
        // pre-existing, unrelated bug (loansRepo.insertRepayment writes
        // status: "paid", but payroll_loan_repayments_status_check only
        // allows pending/deducted/waived/overdue per migration 0027, so the
        // INSERT throws and rolls back the WHOLE run's transaction). Flagged
        // separately; not this PR's concern. The batched loan-fetch itself
        // (loansRepo.findLoansByEmployeesTx) is proven correct and O(1)
        // directly in Section A above, independent of that write-path bug.
        await tx.execute(sql`
          INSERT INTO payroll.payroll_tax_declarations (tenant_id, employee_id, fy, regime, section_80c, section_80d, other_deductions, created_by)
          VALUES (${tenant}::uuid, ${e.id}::uuid, '2026-27', 'old', 100000, 50000, 0, ${ACTOR}::uuid)
        `);
        const priorSlipId = randomUUID();
        await tx.insert(payrollSlips).values({
          id: priorSlipId, tenantId: tenant, runId: approvedRunId, employeeId: e.id, employeeNo: e.employeeNo,
          basicMinor: 3000000n, grossMinor: 5000000n, totalDeductionsMinor: 500000n, netPayMinor: 4500000n,
          currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollTds).values({
          id: randomUUID(), tenantId: tenant, slipId: priorSlipId, employeeId: e.id, runId: approvedRunId,
          annualBasicMinor: 36000000n, taxableMinor: 3000000n, tdsMinor: 500000n, period: "2026-06",
          createdBy: ACTOR, updatedBy: ACTOR,
        });
      }
    }));
    return { employees };
  }

  it("small (3) vs large (20) employee run: correct per-employee results, small bounded query-cost delta", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedFixtures(tenantSmall, 3);
    const large = await seedFixtures(tenantLarge, 20);

    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockImplementation(async (tenant: string, month: string) => {
      const employees = tenant === tenantSmall ? small.employees : large.employees;
      const lopDays = Object.fromEntries(employees.map((e) => [e.id, 10])); // HRMS feed says 10 -- ledger's 2 must win (M2)
      return { month, employees, lopDays };
    });

    async function runPayroll(tenant: string, runId: string) {
      const queue = new MemoryQueue();
      registerPayrollConsumers(queue);
      await queue.publish(COMMANDS.runCreate, {
        messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id: runId, tenantId: tenant, runNo: `RUN-${tenant.slice(0, 8)}`, month: RUN_MONTH },
      });
      await queue.drain();
      expect(queue.dlq, `queue DLQ for tenant ${tenant}: ${JSON.stringify(queue.dlq)}`).toHaveLength(0);
    }

    const runIdSmall = randomUUID();
    const runIdLarge = randomUUID();
    const { queryCount: countSmall } = await countQueriesDuring(() => runPayroll(tenantSmall, runIdSmall));
    const { queryCount: countLarge } = await countQueriesDuring(() => runPayroll(tenantLarge, runIdLarge));

    // Bounded, not O(old-per-employee-cost): the 6 batched sites contribute
    // ~0 marginal cost per additional employee; only the sites deliberately
    // left per-employee (generateRetroArrears read+insert, collectAdHocEarnings's
    // 3 reads, computeAndInsertSlip's ~3 writes, loan repayment read+2 writes,
    // arrears double-pay-guard update) still scale. That ceiling is ~12/employee
    // in this fixture shape; the pre-fix code would have added ~6 more per
    // employee (one per batched site) on top, i.e. ~18. Generous bound below.
    const perEmployeeDelta = (countLarge - countSmall) / (large.employees.length - small.employees.length);
    expect(perEmployeeDelta).toBeLessThanOrEqual(14);

    // ── Correctness: verify DB state for every employee in the large run ──
    const slips = await runWithTenant(tenantLarge, () => db.transaction((tx) =>
      tx.select().from(payrollSlips).where(sql`${payrollSlips.tenantId} = ${tenantLarge}::uuid AND ${payrollSlips.runId} = ${runIdLarge}::uuid`)));
    expect(slips).toHaveLength(20);

    for (const emp of large.employees) {
      const slip = slips.find((s) => s.employeeId === emp.id);
      expect(slip, `slip for ${emp.employeeNo}`).toBeTruthy();

      // P2: Basic sourced from the batched revision fetch, not the HRMS fallback (3000000).
      expect(slip!.basicMinor, `basicMinor for ${emp.employeeNo}`).toBe(3500000n);

      const components = slip!.components as Array<{ code: string; type: string; amountMinor: number }>;

      // M2: ledger (2 days) must win over the HRMS feed (10 days).
      // consumer.ts's lopDeduction is (basicMinor + daMinor) * lopDays /
      // daysInMonth (Basic+DA, the standard LOP base, not Basic alone).
      // basicMinor=3500000, daMinor=50% of that=1750000 (this DA rate is now
      // seeded in seedFixtures and correctly resolved -- see
      // DA_RATE_NOT_CONFIGURED / the scopedRead fix to resolveDaRateBps's
      // call site; before that RLS-scoping fix this read was always blind
      // and daMinor was silently always 0, which is what the previous
      // 233300 (Basic-only) expectation here was quietly depending on).
      // dailyRate = (3500000+1750000)/30 = 175000; * 2 days = 350000 exactly
      // (no rounding needed). If the ledger's 2 days did NOT win, this would
      // instead reflect the HRMS feed's 10 days (1750000) -- 5x off, so this
      // assertion still discriminates.
      const lop = components.find((c) => c.code === "LOP");
      expect(lop?.amountMinor, `LOP for ${emp.employeeNo}`).toBe(350000);

      // H14: PT differs by the employee's own state, from the SAME batched fetch.
      const pt = components.find((c) => c.code === "PT");
      expect(pt?.amountMinor, `PT for ${emp.employeeNo}`).toBe(emp.stateCode === "KA" ? 20000 : 17500);

      // P2 + P1/C2 ordering: the retro arrear generateRetroArrears created for
      // THIS run's revision must be collected and marked paid in this SAME run
      // -- proves hoisting the revision read did not break the
      // generate-then-collect-same-run dependency on collectAdHocEarnings.
      const arrearRows = await runWithTenant(tenantLarge, () => db.transaction((tx) => tx.execute(sql`
        SELECT status, run_id, difference_minor FROM payroll.payroll_arrears
        WHERE tenant_id = ${tenantLarge}::uuid AND employee_id = ${emp.id}::uuid AND from_period = '2026-08'
      `))) as unknown as Array<{ status: string; run_id: string; difference_minor: string }>;
      expect(arrearRows, `arrear row for ${emp.employeeNo}`).toHaveLength(1);
      expect(arrearRows[0]?.status).toBe("paid");
      expect(arrearRows[0]?.run_id).toBe(runIdLarge);
      const arrearComp = components.find((c) => c.code === "ARREAR");
      expect(arrearComp?.amountMinor, `ARREAR component for ${emp.employeeNo}`).toBe(Number(arrearRows[0]?.difference_minor));

      // Iter2/P3 (loan pre-fetch/repayment chain) is deliberately not
      // exercised through this end-to-end path -- see the seeding note
      // above. It is proven correct and O(1) directly in Section A.
    }
  }, { timeout: 60_000 });
});
