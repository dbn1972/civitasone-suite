/**
 * T-STAT delta review of PR #2449, SHOULD-FIX: a DA change is detected from
 * the slip itself -- a month is re-priced when the DA it drew differs from
 * basic x the DA rate now applicable for that month (integer paise, exact
 * compare) -- instead of comparing created_at timestamps, which missed a DA
 * rate edited in place (53% -> 55%: Rs 0 raised where Rs 800 a month was due).
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
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));

async function drawn(tenant: string, emp: string, month: string, basic: number, da: number, hra: number): Promise<void> {
  const actor = randomUUID(); const runId = randomUUID();
  await inTenant(tenant, async (tx) => {
    await repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `R3DA-${runId.slice(0, 8)}`, month, departmentId: null, structureId: randomUUID(), runType: "regular",
      ddoCode: `R3DA-${runId.slice(0, 8)}`, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "disbursed", createdBy: actor, updatedBy: actor,
    });
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId, employeeId: emp, employeeNo: "R3DA", basicMinor: R(basic), grossMinor: R(basic + da + hra),
      totalDeductionsMinor: 0n, netPayMinor: R(basic + da + hra), currency: "INR",
      components: [
        { code: "BASIC", name: "Basic", type: "earning", amountMinor: basic * 100 },
        { code: "DA", name: "DA", type: "earning", amountMinor: da * 100 },
        { code: "HRA", name: "HRA", type: "earning", amountMinor: hra * 100 },
      ],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  });
}
const da = (tenant: string, from: string, bps: number) =>
  inTenant(tenant, (tx) => tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${from}::date, ${bps})`));
const raised = async (tenant: string, emp: string) => (await inTenant(tenant, (tx) => tx.execute(sql`
  SELECT from_period, difference_minor::text AS d FROM payroll.payroll_arrears WHERE tenant_id = ${tenant}::uuid AND employee_id = ${emp}::uuid ORDER BY from_period`)) as unknown as Array<{ from_period: string; d: string }>)
  .map((r) => [r.from_period, BigInt(r.d)]);
const run = (tenant: string, emp: string, month: string) => inTenant(tenant, (tx) => generateRetroArrears(tx, tenant, emp, month, "X", randomUUID()));

describe("T-STAT delta SHOULD-FIX: DA re-pricing by value", () => {
  it("a DA rate edited in place (53% -> 55%) after the months were paid: 2% of basic per month", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5000);
    await da(tenant, "2026-07-01", 5300);
    await drawn(tenant, emp, "2026-07", 40000, 21200, 12000);
    await drawn(tenant, emp, "2026-08", 40000, 21200, 12000);
    await inTenant(tenant, (tx) => tx.execute(sql`UPDATE payroll.dearness_allowance_rates SET rate_bps = 5500 WHERE tenant_id = ${tenant}::uuid AND effective_from = ${"2026-07-01"}::date`));
    await run(tenant, emp, "2026-09");
    expect(await raised(tenant, emp)).toEqual([["2026-07", R(800)], ["2026-08", R(800)]]);
  });

  it("a slip drawn at a stale rate while the newer rate already existed is settled", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5000);
    await da(tenant, "2026-07-01", 5500);
    await drawn(tenant, emp, "2026-07", 40000, 20000, 12000); // drawn at 50%
    await run(tenant, emp, "2026-09");
    expect(await raised(tenant, emp)).toEqual([["2026-07", R(2000)]]);
  });

  it("an unchanged rate raises nothing, and a re-run raises nothing more", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5000);
    await da(tenant, "2026-07-01", 5500);
    await drawn(tenant, emp, "2026-07", 40001, 22001, 12000); // 40,001 x 55% = 22,000.55 -> Rs 22,001 (paise, rounded)
    await run(tenant, emp, "2026-09");
    await run(tenant, emp, "2026-09");
    expect(await raised(tenant, emp)).toEqual([]);
  });
});
