/**
 * F126 (UAT bundle 12) — payroll run with a disbursed loan no longer fails.
 *
 * processPayrollRun recorded each EMI withheld from salary with
 * loansRepo.insertRepayment(... status: "paid" ...), but
 * loans.payroll_loan_repayments_status_check (migration 0027) only allows
 * pending / deducted / waived / overdue. Any run that included an employee
 * with a disbursed loan and a positive applied EMI therefore threw on that
 * INSERT, rolled back the whole run and left it 'failed'
 * (payroll_loan_repayments_status_check). The withheld EMI is now recorded as
 * "deducted".
 *
 * Real DB, real queue consumer, end to end: one employee with two disbursed
 * loans —
 *   A: outstanding 1,200,000, EMI 110,000, 12% p.a. -> interest 12,000,
 *      principal 98,000, outstanding 1,102,000, stays "disbursed";
 *   B: outstanding 50,000, EMI 100,000, 0% -> principal capped at 50,000,
 *      outstanding 0, loan "closed".
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollLoans, payrollLoanRepayments } from "../src/modules/loans/schema.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "91000000-0000-4126-8000-0000000000a1";
const RUN_MONTH = "2026-09";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

afterAll(async () => { await sqlClient.end(); });

describe("F126 — payroll run deducts loan EMI and records the repayment as 'deducted'", () => {
  it("run does not fail; repayment rows are 'deducted' with the interest/principal split; outstanding reduced and a fully repaid loan closed", async () => {
    const tenant = randomUUID();
    const employee = {
      id: randomUUID(), employeeNo: "E-F126", fullName: "Loan Employee",
      basicMinor: "3000000", dateOfJoining: "2020-01-01",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
      cityClass: "X" as const, taxRegime: "new" as const, departmentId: randomUUID(),
      pensionScheme: "NPS" as const, stateCode: "KA",
    };
    const loanA = randomUUID();
    const loanB = randomUUID();

    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      // A run with no DA rate configured fails fast (DA_RATE_NOT_CONFIGURED).
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, '2026-01-01'::date, 5000)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, 'KA', 0, 999999999999, 20000)`);
      await tx.insert(payrollLoans).values([
        {
          id: loanA, tenantId: tenant, loanNo: `LN-A-${tenant.slice(0, 8)}`, employeeId: employee.id,
          principalMinor: 1_200_000n, outstandingMinor: 1_200_000n, emiMinor: 110_000n, tenureMonths: 12,
          interestRatePct: "12.00", disbursedAt: new Date("2026-08-01T00:00:00Z"), status: "disbursed",
          createdBy: ACTOR, updatedBy: ACTOR,
        },
        {
          id: loanB, tenantId: tenant, loanNo: `LN-B-${tenant.slice(0, 8)}`, employeeId: employee.id,
          principalMinor: 500_000n, outstandingMinor: 50_000n, emiMinor: 100_000n, tenureMonths: 5,
          interestRatePct: "0", disbursedAt: new Date("2026-04-01T00:00:00Z"), status: "disbursed",
          createdBy: ACTOR, updatedBy: ACTOR,
        },
      ]);
    }));

    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockImplementation(async (_tenant: string, month: string) => (
      { month, employees: [employee], lopDays: {} }
    ));

    const runId = randomUUID();
    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    await queue.publish(COMMANDS.runCreate, {
      messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: tenant, runNo: `RUN-F126-${tenant.slice(0, 8)}`, month: RUN_MONTH },
    });
    await queue.drain();
    expect(queue.dlq, `queue DLQ: ${JSON.stringify(queue.dlq)}`).toHaveLength(0);

    const read = <T>(fn: (tx: typeof db) => Promise<T>) =>
      runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

    // The run computed instead of failing on payroll_loan_repayments_status_check.
    const [run] = await read((tx) => tx.select().from(payrollRuns).where(sql`${payrollRuns.id} = ${runId}::uuid`));
    expect(run, "payroll run row").toBeTruthy();
    expect(run!.status).not.toBe("failed");
    expect(run!.lastError ?? null).toBeNull();

    // The slip withheld the full EMI (no protected-net trimming at this pay level).
    const slips = await read((tx) => tx.select().from(payrollSlips).where(sql`${payrollSlips.runId} = ${runId}::uuid`));
    expect(slips).toHaveLength(1);
    const components = slips[0]!.components as Array<{ code: string; amountMinor: number }>;
    expect(components.find((c) => c.code === "LOAN_EMI")?.amountMinor).toBe(110_000 + 50_000);

    // One 'deducted' repayment row per loan, linked to this run, correct split.
    const repayments = await read((tx) => tx.select().from(payrollLoanRepayments)
      .where(sql`${payrollLoanRepayments.tenantId} = ${tenant}::uuid`));
    expect(repayments).toHaveLength(2);
    const repA = repayments.find((r) => r.loanId === loanA)!;
    const repB = repayments.find((r) => r.loanId === loanB)!;
    for (const r of [repA, repB]) {
      expect(r.status).toBe("deducted");
      expect(r.runId).toBe(runId);
      expect(r.installmentNo).toBe(1);
      expect(r.paidAt).toBeInstanceOf(Date);
      expect(r.principalMinor + r.interestMinor).toBe(r.totalMinor);
    }
    // 1,200,000 * 12% / 12 = 12,000 interest; 110,000 - 12,000 = 98,000 principal.
    expect(repA.interestMinor).toBe(12_000n);
    expect(repA.principalMinor).toBe(98_000n);
    expect(repA.totalMinor).toBe(110_000n);
    // 0% loan with only 50,000 left: principal capped at the outstanding.
    expect(repB.interestMinor).toBe(0n);
    expect(repB.principalMinor).toBe(50_000n);
    expect(repB.totalMinor).toBe(50_000n);

    // Outstanding reduced by principal only; the fully repaid loan is closed.
    const loans = await read((tx) => tx.select().from(payrollLoans).where(sql`${payrollLoans.tenantId} = ${tenant}::uuid`));
    const a = loans.find((l) => l.id === loanA)!;
    const b = loans.find((l) => l.id === loanB)!;
    expect(a.outstandingMinor).toBe(1_102_000n);
    expect(a.status).toBe("disbursed");
    expect(b.outstandingMinor).toBe(0n);
    expect(b.status).toBe("closed");
  }, { timeout: 60_000 });
});
