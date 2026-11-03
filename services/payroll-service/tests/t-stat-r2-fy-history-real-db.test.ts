/**
 * T-STAT review of PR #2449, SHOULD-FIX 1 / 2 (DB side) and the recorded-month nit.
 *  - Recorded months are months with a regular (or pensioner) slip; a month
 *    with only a supplementary slip still has its regular pay estimated.
 *  - LOP recorded in the local ledger for months with no slip is read in one
 *    batched, tenant-scoped query.
 *  - A pensioner run projects pension actually paid this FY + current pension
 *    x remaining months, from the pension commencement month when recorded.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";
import { resolveFyPaidToDateTx, resolveUnrecordedLopDaysTx, registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

afterAll(async () => { await sqlClient.end(); });
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));

async function slip(tenant: string, employeeId: string, month: string, gross: number, runType: string, status = "approved"): Promise<void> {
  const actor = randomUUID(); const runId = randomUUID();
  await inTenant(tenant, async (tx) => {
    await repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `FYH-${runId.slice(0, 8)}`, month, departmentId: null, structureId: randomUUID(),
      runType, ddoCode: `FYH-${runId.slice(0, 8)}`, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status, createdBy: actor, updatedBy: actor,
    });
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId, employeeId, employeeNo: "FYH", basicMinor: R(gross), grossMinor: R(gross),
      totalDeductionsMinor: 0n, netPayMinor: R(gross), currency: "INR",
      components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: gross * 100 }],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  });
}

describe("T-STAT: FY history for the s.192 estimate", () => {
  it("recorded months are regular / pensioner months; supplementary pay counts in the amount only", async () => {
    const tenant = randomUUID(); const a = randomUUID();
    await slip(tenant, a, "2026-04", 50000, "regular");
    await slip(tenant, a, "2026-05", 50000, "regular");
    await slip(tenant, a, "2026-06", 7000, "supplementary"); // June regular pay never ran here
    const m = await inTenant(tenant, (tx) => resolveFyPaidToDateTx(tx, tenant, [a], 2026, "2026-07"));
    expect(m.get(a)).toEqual({ grossMinor: R(107000), months: 2, recordedMonths: ["2026-04", "2026-05"] });
  });

  it("LOP ledger days for the FY months before the run, batched and tenant-scoped", async () => {
    const tenant = randomUUID(); const a = randomUUID(); const b = randomUUID();
    await inTenant(tenant, (tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_lop_ledger (tenant_id, employee_id, month, lop_days, source) VALUES
        (${tenant}::uuid, ${a}::uuid, ${"2026-06"}, 10, ${"leave"}),
        (${tenant}::uuid, ${a}::uuid, ${"2026-06"}, 5, ${"attendance_sync"}),
        (${tenant}::uuid, ${a}::uuid, ${"2026-03"}, 9, ${"leave"}),
        (${tenant}::uuid, ${a}::uuid, ${"2026-07"}, 9, ${"leave"})`));
    const other = randomUUID();
    await inTenant(other, (tx) => tx.execute(sql`INSERT INTO payroll.payroll_lop_ledger (tenant_id, employee_id, month, lop_days, source) VALUES (${other}::uuid, ${b}::uuid, ${"2026-05"}, 30, ${"leave"})`));
    const m = await inTenant(tenant, (tx) => resolveUnrecordedLopDaysTx(tx, tenant, [a, b], 2026, "2026-07"));
    expect([...(m.get(a) ?? new Map()).entries()]).toEqual([["2026-06", 15]]);
    expect(m.get(b)).toBeUndefined();
  });
});

describe("T-STAT SF2: pensioner run TDS uses the s.192 estimate", () => {
  it("a pensioner from October is projected over paid + 4 months; a whole-year pensioner is unchanged", async () => {
    const tenant = randomUUID(); const actor = randomUUID(); const approver = randomUUID();
    const mid = randomUUID(); const full = randomUUID();
    await inTenant(tenant, async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${"2026-01-01"}::date, 5000)`);
      for (const [id, ppo, commencement] of [[mid, "PPO-MID", "2026-10-01"], [full, "PPO-FULL", null]] as const) {
        await tx.execute(sql`
          INSERT INTO payroll.payroll_pensioners (id, tenant_id, ppo_no, full_name, date_of_birth, basic_pension_minor, status, tax_regime, pension_commencement_date, created_by, updated_by)
          VALUES (${id}::uuid, ${tenant}::uuid, ${ppo}, ${"Pensioner " + ppo}, ${"1964-06-15"}::date, ${R(200000).toString()}::bigint, ${"active"}, ${"new"}, ${commencement}::date, ${actor}::uuid, ${actor}::uuid)`);
      }
    });
    // October and November pension paid to the mid-year pensioner in approved pensioner runs.
    await slip(tenant, mid, "2026-10", 300000, "pensioner");
    await slip(tenant, mid, "2026-11", 300000, "pensioner");

    const queue = new MemoryQueue();
    registerPayrollConsumers(queue);
    const runId = randomUUID();
    await queue.publish(COMMANDS.runCreate, {
      messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: approver, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId: tenant, runNo: "PEN-2026-12", month: "2026-12", runType: "pensioner" },
    });
    await queue.drain();
    expect(queue.dlq).toHaveLength(0);
    const tds = await inTenant(tenant, async (tx) => (await tx.execute(sql`
      SELECT employee_id::text AS e, taxable_minor::text AS t FROM statutory.payroll_tds WHERE tenant_id = ${tenant}::uuid AND run_id = ${runId}::uuid`)) as unknown as Array<{ e: string; t: string }>);
    const by = Object.fromEntries(tds.map((r) => [r.e, BigInt(r.t)]));
    // Pension 2,00,000 + DR 50% = 3,00,000 a month.
    expect(by[mid]).toBe(R(600000 + 300000 * 4 - 75000)); // was 3,00,000 x 12 - 75,000 = 35,25,000
    expect(by[full]).toBe(R(300000 * 12 - 75000));
  });
});
