/**
 * UAT L2-N3 review: sending a computed run back (computed -> failed) unwinds
 * its computation so the period can be computed again and every employee is
 * paid exactly once. Real DB, real consumers, end to end: one employee with a
 * disbursed loan that the run closes, an approved bonus and an approved
 * reimbursement.
 *   R1 computes -> sent back -> loan, bonus, reimbursement, statutory rows,
 *   register and employee claim are all as before R1;
 *   R2 (same month) computes and pays them once.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollLoans } from "../src/modules/loans/schema.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = randomUUID();
const ADMIN = randomUUID();
const RUN_MONTH = "2026-09";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

afterAll(async () => { await sqlClient.end(); });

describe("send back a computed run: the computation is unwound (UAT L2-N3 review)", () => {
  it("restores loans, bonus, reimbursements, statutory rows, register and claims; a recomputation pays them once", async () => {
    const tenant = randomUUID();
    const employee = {
      id: randomUUID(), employeeNo: "E-UNWIND", fullName: "Unwind Employee",
      basicMinor: "3000000", dateOfJoining: "2020-01-01",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null,
      cityClass: "X" as const, taxRegime: "new" as const, departmentId: randomUUID(),
      pensionScheme: "NPS" as const, stateCode: "KA",
    };
    const loan = randomUUID();
    const bonus = randomUUID();
    const reimb = randomUUID();
    const read = <T>(fn: (tx: typeof db) => Promise<T>) =>
      runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
    const q = async <T>(query: ReturnType<typeof sql>) => Array.from((await read((tx) => tx.execute(query))) as unknown as Iterable<T>);

    await read(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${"2026-01-01"}::date, 5000)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor) VALUES (${tenant}::uuid, ${"KA"}, 0, 999999999999, 20000)`);
      await tx.insert(payrollLoans).values({
        id: loan, tenantId: tenant, loanNo: `LN-UW-${tenant.slice(0, 8)}`, employeeId: employee.id,
        principalMinor: 500_000n, outstandingMinor: 50_000n, emiMinor: 100_000n, tenureMonths: 5,
        interestRatePct: "0", disbursedAt: new Date("2026-04-01T00:00:00Z"), status: "disbursed",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.execute(sql`INSERT INTO payroll.payroll_bonus (id, tenant_id, employee_id, fy, basic_minor, bonus_amount_minor, status)
        VALUES (${bonus}::uuid, ${tenant}::uuid, ${employee.id}::uuid, ${"2026-27"}, 3000000, 250000, ${"approved"})`);
      await tx.execute(sql`INSERT INTO payroll.payroll_reimbursements (id, tenant_id, employee_id, category, amount_minor, period, status, created_by)
        VALUES (${reimb}::uuid, ${tenant}::uuid, ${employee.id}::uuid, ${"travel"}, 120000, ${RUN_MONTH}, ${"approved"}, ${ACTOR}::uuid)`);
    });
    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, month: string) => ({ month, employees: [employee], lopDays: {} }));

    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const publish = async (topic: string, payload: Record<string, unknown>, actorId = ACTOR) => {
      await queue.publish(topic, { messageId: randomUUID(), type: topic, tenantId: tenant, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: tenant, ...payload } });
      await queue.drain();
    };
    const compute = (runId: string) => publish(COMMANDS.runCreate, { id: runId, runNo: `RUN-UW-${runId.slice(0, 8)}`, month: RUN_MONTH });
    const runStatus = async (runId: string) => (await q<{ status: string; last_error: string | null }>(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`))[0];
    const loanRow = async () => (await q<{ outstanding_minor: string; status: string }>(sql`SELECT outstanding_minor::text, status FROM loans.payroll_loans WHERE id = ${loan}::uuid`))[0];
    const consumed = async () => ({
      bonus: (await q<{ status: string; paid_in_run_id: string | null }>(sql`SELECT status, paid_in_run_id::text FROM payroll.payroll_bonus WHERE id = ${bonus}::uuid`))[0],
      reimb: (await q<{ status: string; paid_in_run_id: string | null }>(sql`SELECT status, paid_in_run_id::text FROM payroll.payroll_reimbursements WHERE id = ${reimb}::uuid`))[0],
    });
    const runCounts = async (runId: string) => (await q<Record<string, number>>(sql`SELECT
      (SELECT COUNT(*)::int FROM loans.payroll_loan_repayments WHERE run_id = ${runId}::uuid) AS repayments,
      (SELECT COUNT(*)::int FROM statutory.payroll_nps WHERE run_id = ${runId}::uuid) AS nps,
      (SELECT COUNT(*)::int FROM statutory.payroll_tds WHERE run_id = ${runId}::uuid) AS tds,
      (SELECT COUNT(*)::int FROM payroll.payroll_register WHERE run_id = ${runId}::uuid) AS register,
      (SELECT COUNT(*)::int FROM payroll.payroll_run_employee_claims WHERE run_id = ${runId}::uuid) AS claims,
      (SELECT COUNT(*)::int FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid) AS slips`))[0]!;
    const slipCodes = async (runId: string) => {
      const s = await q<{ components: Array<{ code: string; amountMinor: number }> }>(sql`SELECT components FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`);
      return Object.fromEntries(s[0]!.components.map((c) => [c.code, c.amountMinor]));
    };

    // R1 computes: the loan is closed, bonus and reimbursement consumed.
    const r1 = randomUUID();
    await compute(r1);
    expect(queue.dlq, JSON.stringify(queue.dlq)).toHaveLength(0);
    expect((await runStatus(r1))?.status).toBe("computed");
    expect(await loanRow()).toEqual({ outstanding_minor: "0", status: "closed" });
    expect((await consumed()).bonus).toEqual({ status: "paid", paid_in_run_id: r1 });
    const before = await runCounts(r1);
    expect(before.repayments).toBe(1);
    expect(before.nps).toBeGreaterThan(0);
    expect(before.slips).toBe(1);
    const r1Codes = await slipCodes(r1);
    expect(r1Codes.LOAN_EMI).toBe(50_000);
    expect(r1Codes.BONUS).toBe(250_000);
    expect(r1Codes.REIMB).toBe(120_000);

    // A payroll admin sends R1 back.
    await publish(COMMANDS.runReject, { id: r1, rejectedBy: ADMIN, reason: "recompute after the DA rate fix" }, ADMIN);
    expect(queue.dlq, JSON.stringify(queue.dlq)).toHaveLength(0);
    expect(await runStatus(r1)).toEqual({ status: "failed", last_error: "sent back by a payroll admin: recompute after the DA rate fix" });
    expect(await loanRow()).toEqual({ outstanding_minor: "50000", status: "disbursed" });
    expect(await consumed()).toEqual({ bonus: { status: "approved", paid_in_run_id: null }, reimb: { status: "approved", paid_in_run_id: null } });
    expect(await runCounts(r1)).toEqual({ repayments: 0, nps: 0, tds: 0, register: 0, claims: 0, slips: 1 });

    // R2, a new REGULAR run for the same month (the failed R1 no longer blocks the
    // period), pays the same things exactly once.
    const r2 = randomUUID();
    await compute(r2);
    expect(queue.dlq, JSON.stringify(queue.dlq)).toHaveLength(0);
    expect((await runStatus(r2))?.status).toBe("computed");
    expect(await slipCodes(r2)).toEqual(r1Codes);
    expect(await loanRow()).toEqual({ outstanding_minor: "0", status: "closed" });
    expect((await consumed()).bonus).toEqual({ status: "paid", paid_in_run_id: r2 });
    expect((await consumed()).reimb).toEqual({ status: "paid", paid_in_run_id: r2 });
    const after = await runCounts(r2);
    expect(after.repayments).toBe(1);
    expect(after.nps).toBe(before.nps);

    // A duplicate send-back of the (now failed) R1 is a no-op.
    await publish(COMMANDS.runReject, { id: r1, rejectedBy: ADMIN, reason: "recompute after the DA rate fix" }, ADMIN);
    expect(queue.dlq).toHaveLength(0);
    expect(await loanRow()).toEqual({ outstanding_minor: "0", status: "closed" });
  });
});
