/**
 * T-STAT F03 (HIGH, statutory audit 2026-11-03): retro arrears were priced
 * from the salary-revision record (new basic - old basic, for every month
 * from the effective month to the run month) and never looked at what was
 * actually drawn. Superseding revisions and months already paid at the
 * revised rate were ignored: UATG1-34285 was paid Rs 5,640 of arrears for
 * December and January on top of slips already drawn at (or above) the
 * revised level -- a Rs 11,280 overpayment in disbursed runs.
 *
 * ERP-head decision (owner-delegated, FIX-QUEUE 2026-11-03): arrears for a
 * month = pay due for that month under the revised rates (the latest
 * applicable revision and the DA rate now in force for that month) - pay
 * actually drawn for that month (the regular slips already approved or
 * disbursed, plus arrears already raised for it). Months already drawn at the
 * revised rate produce nothing; a month with no drawn slip is left to its own
 * regular run (which pays the revised rate) and is reported, never presumed
 * drawn at the old rate.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";
import { generateRetroArrears } from "../src/modules/payroll/consumer.js";

afterAll(async () => { await sqlClient.end(); });

const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;

async function inTenant<T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));
}

/** A disbursed regular run for `month` with one slip drawing BASIC/DA/HRA (rupees). */
async function seedDrawnSlip(tenant: string, employeeId: string, month: string, basic: number, da: number, hra: number, status = "disbursed"): Promise<string> {
  const actor = randomUUID();
  const runId = randomUUID();
  await inTenant(tenant, async (tx) => {
    await repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `TSTAT-${month}-${runId.slice(0, 6)}`, month, departmentId: null,
      structureId: randomUUID(), runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status, createdBy: actor, updatedBy: actor,
    });
    const gross = R(basic + da + hra);
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId, employeeId, employeeNo: "TSTAT-1",
      basicMinor: R(basic), grossMinor: gross, totalDeductionsMinor: 0n, netPayMinor: gross, currency: "INR",
      components: [
        { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: basic * 100 },
        { code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: da * 100 },
        { code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: hra * 100 },
      ],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  });
  return runId;
}

async function seedRevision(tenant: string, employeeId: string, effective: string, oldBasic: number, newBasic: number, status = "approved"): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_salary_revisions
      (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, status)
    VALUES (${tenant}::uuid, ${employeeId}::uuid, ${effective}::date, ${R(oldBasic).toString()}::bigint, ${R(newBasic).toString()}::bigint, 0, 0, ${status})
  `));
}

async function seedDa(tenant: string, rows: Array<[string, number]>): Promise<void> {
  for (const [from, bps] of rows) {
    await inTenant(tenant, (tx) => tx.execute(sql`
      INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${from}::date, ${bps})
    `));
  }
}

type ArrearRow = { from_period: string; component_code: string; difference_minor: string; pension_base_minor: string | null; settled_in_period: string; status: string };
async function arrears(tenant: string, employeeId: string): Promise<ArrearRow[]> {
  return inTenant(tenant, async (tx) => (await tx.execute(sql`
    SELECT from_period, component_code, difference_minor::text, pension_base_minor::text, settled_in_period, status
    FROM payroll.payroll_arrears WHERE tenant_id = ${tenant}::uuid AND employee_id = ${employeeId}::uuid
    ORDER BY settled_in_period, from_period, component_code
  `)) as unknown as ArrearRow[]);
}

async function run(tenant: string, employeeId: string, runMonth: string) {
  return inTenant(tenant, (tx) => generateRetroArrears(tx, tenant, employeeId, runMonth, "X", randomUUID()));
}

async function markPaid(tenant: string, employeeId: string): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`
    UPDATE payroll.payroll_arrears SET status = ${"paid"}, run_id = gen_random_uuid()
    WHERE tenant_id = ${tenant}::uuid AND employee_id = ${employeeId}::uuid AND run_id IS NULL
  `));
}

describe("T-STAT F03: arrears = due under the revised rates - actually drawn", () => {
  it("UATG1-34285 pattern: December and January already drawn at the revised rate produce NO arrears", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2025-07-01", 5800]]);
    // 30,000 -> 33,000 from 1-11-2026; superseded by 30,000 -> 30,900 from 1-1-2027.
    await seedRevision(tenant, emp, "2026-11-01", 30000, 33000);
    await seedRevision(tenant, emp, "2027-01-01", 30000, 31500, "rejected");
    await seedRevision(tenant, emp, "2027-01-01", 30000, 30900);
    // November drawn at the OLD 30,000 (a genuine arrear month); December at 33,000 and January
    // at 30,900, i.e. both already at the revision in force for them. No February slip yet.
    await seedDrawnSlip(tenant, emp, "2026-11", 30000, 17400, 9000);
    await seedDrawnSlip(tenant, emp, "2026-12", 33000, 19140, 9900);
    await seedDrawnSlip(tenant, emp, "2027-01", 30900, 17922, 9270);

    const outcome = await run(tenant, emp, "2027-03");
    const rows = await arrears(tenant, emp);
    // Old engine: 4 x 5,640 for Nov..Feb (Rs 22,560), incl. Dec + Jan = the Rs 11,280 overpayment.
    expect(rows.map((r) => [r.from_period, r.component_code, BigInt(r.difference_minor)])).toEqual([
      ["2026-11", "ARREAR", R(3000 + 1740 + 900)],
    ]);
    expect(BigInt(rows[0]!.pension_base_minor!)).toBe(R(3000 + 1740)); // M-NPS: Basic + DA part
    expect(rows[0]!.settled_in_period).toBe("2027-03");
    // February was never drawn: reported, left to its own regular run (which pays 30,900).
    expect(outcome.notDrawnPeriods).toEqual(["2027-02"]);
    expect(outcome.overdrawn).toEqual([]);
  });

  it("the disbursed double payment (arrear already paid on top of a slip at the revised rate) is reported, not reversed", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2025-07-01", 5800]]);
    await seedRevision(tenant, emp, "2026-11-01", 30000, 33000);
    await seedDrawnSlip(tenant, emp, "2026-12", 33000, 19140, 9900);
    // The legacy engine already paid a Dec arrear of 5,640 on top of the 33,000 slip.
    await inTenant(tenant, (tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor,
        new_amount_minor, difference_minor, reason, status, source, created_by, run_id)
      VALUES (${tenant}::uuid, ${emp}::uuid, ${"ARREAR"}, ${"2026-12"}, ${"2026-12"}, 3000000, 3300000, 564000, ${"legacy"}, ${"paid"}, ${"revision"}, gen_random_uuid(), gen_random_uuid())
    `));
    const outcome = await run(tenant, emp, "2027-01");
    const rows = await arrears(tenant, emp);
    expect(rows).toHaveLength(1); // only the legacy row; no recovery raised
    expect(outcome.overdrawn).toEqual([{ period: "2026-12", amountMinor: R(5640) }]);
  });

  it("two successive DA revisions: each month is settled against the latest DA rate, only the increment is paid", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2026-01-01", 5000]]);
    for (const m of ["2026-07", "2026-08", "2026-09"]) await seedDrawnSlip(tenant, emp, m, 50000, 25000, 15000);
    // DA revision 1: 53% from 1-7-2026, notified after the September payroll.
    await seedDa(tenant, [["2026-07-01", 5300]]);
    await run(tenant, emp, "2026-10");
    let rows = await arrears(tenant, emp);
    expect(rows.map((r) => [r.from_period, BigInt(r.difference_minor), BigInt(r.pension_base_minor!)])).toEqual([
      ["2026-07", R(1500), R(1500)], ["2026-08", R(1500), R(1500)], ["2026-09", R(1500), R(1500)],
    ]);
    await markPaid(tenant, emp);
    // October drawn at 53%. DA revision 2: 55% from 1-9-2026.
    await seedDrawnSlip(tenant, emp, "2026-10", 50000, 26500, 15000);
    await seedDa(tenant, [["2026-09-01", 5500]]);
    await run(tenant, emp, "2026-11");
    rows = (await arrears(tenant, emp)).filter((r) => r.settled_in_period === "2026-11");
    // July/August already settled at 53% (still the rate in force for them): nothing more.
    // September: due 27,500 DA vs 25,000 drawn + 1,500 arrear = 1,000. October: 27,500 vs 26,500 = 1,000.
    expect(rows.map((r) => [r.from_period, BigInt(r.difference_minor)])).toEqual([
      ["2026-09", R(1000)], ["2026-10", R(1000)],
    ]);
  });

  it("revision effective mid-FY with 3 months to settle; re-running the same month is idempotent", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2025-07-01", 5800]]);
    for (const m of ["2026-08", "2026-09", "2026-10"]) await seedDrawnSlip(tenant, emp, m, 50000, 29000, 15000);
    await seedRevision(tenant, emp, "2026-08-01", 50000, 55000);
    await run(tenant, emp, "2026-11");
    await run(tenant, emp, "2026-11"); // M1 resume / redelivery
    const rows = await arrears(tenant, emp);
    // Per month: basic 5,000 + DA 58% 2,900 + HRA 30% 1,500 = 9,400; NPS base 7,900.
    expect(rows.map((r) => [r.from_period, BigInt(r.difference_minor), BigInt(r.pension_base_minor!)])).toEqual([
      ["2026-08", R(9400), R(7900)], ["2026-09", R(9400), R(7900)], ["2026-10", R(9400), R(7900)],
    ]);
    // A later run after they are paid adds nothing more for those months.
    await markPaid(tenant, emp);
    await seedDrawnSlip(tenant, emp, "2026-11", 55000, 31900, 16500);
    await run(tenant, emp, "2026-12");
    expect(await arrears(tenant, emp)).toHaveLength(3);
  });

  it("a back-dated pay DECREASE against a drawn slip is still recovered (H1), as a floor-protected ARREAR_RECOVERY", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2025-07-01", 5800]]);
    await seedDrawnSlip(tenant, emp, "2026-09", 50000, 29000, 15000);
    await seedRevision(tenant, emp, "2026-09-01", 50000, 45000);
    await run(tenant, emp, "2026-10");
    const rows = await arrears(tenant, emp);
    expect(rows.map((r) => [r.from_period, r.component_code, BigInt(r.difference_minor), BigInt(r.pension_base_minor!)])).toEqual([
      ["2026-09", "ARREAR_RECOVERY", R(9400), R(7900)],
    ]);
  });

  it("slips of draft / processing runs are not treated as drawn", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await seedDa(tenant, [["2025-07-01", 5800]]);
    await seedDrawnSlip(tenant, emp, "2026-09", 50000, 29000, 15000, "processing");
    await seedRevision(tenant, emp, "2026-09-01", 50000, 55000);
    const outcome = await run(tenant, emp, "2026-10");
    expect(await arrears(tenant, emp)).toEqual([]);
    expect(outcome.notDrawnPeriods).toEqual(["2026-09"]);
  });
});
