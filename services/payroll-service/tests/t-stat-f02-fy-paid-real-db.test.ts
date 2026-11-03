/**
 * T-STAT F02 / M-NPS, the DB side: the run reads the salary actually paid to
 * each employee earlier in the FY from the payslips of approved / disbursed
 * runs (tenant-scoped, FORCE RLS), and collectAdHocEarnings hands the Basic +
 * DA part of collected arrears to the NPS base.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";
import { resolveFyPaidToDateTx, collectAdHocEarnings } from "../src/modules/payroll/consumer.js";

afterAll(async () => { await sqlClient.end(); });
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));

async function slip(tenant: string, employeeId: string, month: string, gross: number, status: string, lop = 0, runType = "regular"): Promise<void> {
  const actor = randomUUID(); const runId = randomUUID();
  await inTenant(tenant, async (tx) => {
    await repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `FYP-${runId.slice(0, 8)}`, month, departmentId: null, structureId: randomUUID(),
      runType, ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status, createdBy: actor, updatedBy: actor,
    });
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId, employeeId, employeeNo: "FYP", basicMinor: R(gross), grossMinor: R(gross),
      totalDeductionsMinor: R(lop), netPayMinor: R(gross - lop), currency: "INR",
      components: [
        { code: "BASIC", name: "Basic", type: "earning", amountMinor: gross * 100 },
        ...(lop ? [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: lop * 100 }] : []),
      ],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  });
}

describe("T-STAT F02: salary actually paid earlier in the FY", () => {
  it("sums approved/disbursed slips of this FY before the run month, less LOP, counting months", async () => {
    const tenant = randomUUID(); const a = randomUUID(); const b = randomUUID();
    await slip(tenant, a, "2026-03", 99999, "disbursed"); // previous FY: ignored
    await slip(tenant, a, "2026-04", 50000, "disbursed");
    await slip(tenant, a, "2026-05", 50000, "approved", 2000);
    await slip(tenant, a, "2026-05", 7000, "approved", 0, "supplementary"); // same month, extra pay
    await slip(tenant, a, "2026-06", 50000, "processing"); // not paid yet: ignored
    await slip(tenant, a, "2026-07", 50000, "disbursed"); // the run month itself: ignored
    await slip(tenant, b, "2026-04", 10000, "draft", 0, "arrears");
    const other = randomUUID();
    await slip(other, a, "2026-04", 12345, "disbursed"); // another tenant: invisible

    const m = await inTenant(tenant, (tx) => resolveFyPaidToDateTx(tx, tenant, [a, b], 2026, "2026-07"));
    expect(m.get(a)).toEqual({ grossMinor: R(50000 + 50000 - 2000 + 7000), months: 2, recordedMonths: ["2026-04", "2026-05"] });
    expect(m.get(b)).toBeUndefined();
  });
});

describe("T-STAT M-NPS: collected arrears carry their Basic + DA part", () => {
  it("revision arrears use pension_base_minor; manual BASIC/DA arrears count in full; HRA does not", async () => {
    const tenant = randomUUID(); const emp = randomUUID(); const actor = randomUUID();
    await inTenant(tenant, (tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor,
        new_amount_minor, difference_minor, reason, status, source, created_by, pension_base_minor, settled_in_period)
      VALUES
        (${tenant}::uuid, ${emp}::uuid, ${"ARREAR"}, ${"2026-08"}, ${"2026-08"}, 0, 0, 940000, ${"r"}, ${"approved"}, ${"revision"}, ${actor}::uuid, 790000, ${"2026-11"}),
        (${tenant}::uuid, ${emp}::uuid, ${"ARREAR_RECOVERY"}, ${"2026-09"}, ${"2026-09"}, 0, 0, 94000, ${"r"}, ${"approved"}, ${"revision"}, ${actor}::uuid, 79000, ${"2026-11"}),
        (${tenant}::uuid, ${emp}::uuid, ${"BASIC"}, ${"2026-04"}, ${"2026-04"}, 0, 0, 500000, ${"m"}, ${"approved"}, ${"manual"}, ${actor}::uuid, NULL, ${""}),
        (${tenant}::uuid, ${emp}::uuid, ${"HRA"}, ${"2026-04"}, ${"2026-04"}, 0, 0, 100000, ${"m"}, ${"approved"}, ${"manual"}, ${actor}::uuid, NULL, ${""})
    `));
    const got = await inTenant(tenant, (tx) => collectAdHocEarnings(tx, tenant, emp, "2026-11"));
    expect(got.arrearPensionBaseMinor).toBe(R(7900 - 790 + 5000));
  });
});
