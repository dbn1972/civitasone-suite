/**
 * T-STAT review of PR #2449, blocker B1: "due minus drawn" arrears must follow
 * the days actually payable in the month.
 *
 * The run keeps BASIC at the full month and recovers unpaid days (loss of pay,
 * EOL, the days before joining or after leaving) as an LOP deduction on
 * (Basic + DA [+ deputation allowance]). The first cut summed only the earning
 * lines as "drawn" and priced "due" for a full month, so an EOL month earned a
 * full month of DA arrears (and NPS on them). Now the arrear for a month is
 *   (due for the full month - drawn earning lines) x (payable share of the month)
 * where the payable share is 1 - LOP / (Basic + DA + allowance) of the drawn
 * slip -- the same days the slip itself paid.
 *
 * Also: a DA change is settled only for months whose slip drew a DA different
 * from basic x the DA rate now applicable for the month (delta review: a value
 * check, not a timestamp); months already drawn at the rate in force are never
 * re-priced, so there is no blanket 12-month re-pricing. And the arrears step reads its inputs once per run, not per
 * employee.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant, addQueryDebugListener, removeQueryDebugListener } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";
import { generateRetroArrears, prefetchRetroArrearsTx } from "../src/modules/payroll/consumer.js";

afterAll(async () => { await sqlClient.end(); });

/**
 * Counts the statements the CODE UNDER TEST issues. postgres-js also runs its own
 * driver-bootstrap statements (the pg_type array-type fetch) on every connection it
 * opens, and the debug hook reports those too. Under load the pool can open or recycle a
 * connection in the middle of a measurement, which added one such statement to one side of
 * a "same number of queries" comparison. That statement is not a query of the code under
 * test, so it is excluded by its text; every other statement still counts.
 */
const DRIVER_BOOTSTRAP = /\bpg_catalog\.pg_type\b/i;
async function countAppQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queryCount: number }> {
  let queryCount = 0;
  const listener = (_conn: number, query: string) => { if (!DRIVER_BOOTSTRAP.test(query)) queryCount++; };
  addQueryDebugListener(listener);
  try { return { result: await fn(), queryCount }; } finally { removeQueryDebugListener(listener); }
}

const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));

type Lines = { basic: number; da: number; hra: number; lop?: number };
/** A disbursed regular run for `month` with one slip (rupees); LOP is the deduction line the run writes. */
async function drawn(tenant: string, emp: string, month: string, l: Lines): Promise<void> {
  const actor = randomUUID(); const runId = randomUUID();
  await inTenant(tenant, async (tx) => {
    await repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `R2-${month}-${runId}`, month, departmentId: null,
      structureId: randomUUID(), runType: "regular", ddoCode: `R2-${runId.slice(0, 8)}`, totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status: "disbursed", createdBy: actor, updatedBy: actor,
    });
    const gross = R(l.basic + l.da + l.hra);
    await repo.insertSlip(tx as never, {
      id: randomUUID(), tenantId: tenant, runId, employeeId: emp, employeeNo: `R2-${emp.slice(0, 4)}`,
      basicMinor: R(l.basic), grossMinor: gross, totalDeductionsMinor: R(l.lop ?? 0), netPayMinor: gross - R(l.lop ?? 0), currency: "INR",
      components: [
        { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: l.basic * 100 },
        { code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: l.da * 100 },
        { code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: l.hra * 100 },
        ...(l.lop ? [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: l.lop * 100 }] : []),
      ],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  });
}
async function da(tenant: string, from: string, bps: number): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${from}::date, ${bps})`));
}
async function revision(tenant: string, emp: string, effective: string, oldBasic: number, newBasic: number): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, status)
    VALUES (${tenant}::uuid, ${emp}::uuid, ${effective}::date, ${R(oldBasic).toString()}::bigint, ${R(newBasic).toString()}::bigint, 0, 0, ${"approved"})`));
}
type Row = { from_period: string; component_code: string; d: string; pb: string | null; source: string };
async function raised(tenant: string, emp: string): Promise<Row[]> {
  return inTenant(tenant, async (tx) => (await tx.execute(sql`
    SELECT from_period, component_code, difference_minor::text AS d, pension_base_minor::text AS pb, source
    FROM payroll.payroll_arrears WHERE tenant_id = ${tenant}::uuid AND employee_id = ${emp}::uuid ORDER BY from_period`)) as unknown as Row[]);
}
const run = (tenant: string, emp: string, runMonth: string) =>
  inTenant(tenant, (tx) => generateRetroArrears(tx, tenant, emp, runMonth, "X", randomUUID()));
const rows = (r: Row[]) => r.map((x) => [x.from_period, x.component_code, BigInt(x.d), x.pb == null ? null : BigInt(x.pb)]);

describe("T-STAT B1: arrears follow the days actually payable", () => {
  it("a full EOL month earns NO DA arrear; the next, fully paid month earns the full DA difference", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5000);
    // July: whole month EOL -- LOP = Basic + DA = 60,000, nothing paid. August paid in full.
    await drawn(tenant, emp, "2026-07", { basic: 40000, da: 20000, hra: 12000, lop: 60000 });
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 20000, hra: 12000 });
    // DA 55% from 1-7-2026, notified after both payrolls (a retrospective DA order).
    await da(tenant, "2026-07-01", 5500);
    await run(tenant, emp, "2026-09");
    // July: 0 (was 2,000 + NPS on it). August: 5% of 40,000 = 2,000, all of it Basic + DA.
    expect(rows(await raised(tenant, emp))).toEqual([["2026-08", "ARREAR", R(2000), R(2000)]]);
  });

  it("partial LOP: 10 unpaid days of 31 -> the arrear covers the 21 paid days", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5500);
    // LOP = (40,000 + 22,000) x 10 / 31 = 20,000.
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000, lop: 20000 });
    await revision(tenant, emp, "2026-08-01", 40000, 42000);
    await run(tenant, emp, "2026-09");
    // Full-month difference 2,000 + 1,100 + 600 = 3,700; x 21/31 = 2,506.45. Basic + DA part 3,100 x 21/31 = 2,100.
    expect(rows(await raised(tenant, emp))).toEqual([["2026-08", "ARREAR", R(2506), R(2100)]]);
  });

  it("joining month: joined 20 August (19 days before joining recovered as LOP) -> 12/31 of the month", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5500);
    // LOP for the 19 days before joining = 62,000 x 19 / 31 = 38,000.
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000, lop: 38000 });
    await revision(tenant, emp, "2026-08-01", 40000, 42000);
    await run(tenant, emp, "2026-09");
    // 3,700 x 12/31 = 1,432.26 (the first cut raised the full 3,700). Basic + DA part 3,100 x 12/31 = 1,200.
    expect(rows(await raised(tenant, emp))).toEqual([["2026-08", "ARREAR", R(1432), R(1200)]]);
  });

  it("leaving month: left 10 September -> 10/30 of September; nothing for the months after leaving", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5500);
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000 });
    // 20 days after leaving recovered as LOP: 62,000 x 20 / 30 = 41,333.
    await drawn(tenant, emp, "2026-09", { basic: 40000, da: 22000, hra: 12000, lop: 41333 });
    await revision(tenant, emp, "2026-08-01", 40000, 42000);
    const out = await run(tenant, emp, "2026-11");
    // August full 3,700; September 3,700 x 20,667/62,000 = 1,233.3; October (no slip, left) nothing.
    expect(rows(await raised(tenant, emp))).toEqual([
      ["2026-08", "ARREAR", R(3700), R(3100)],
      ["2026-09", "ARREAR", R(1233), R(1033)],
    ]);
    expect(out.notDrawnPeriods).toEqual(["2026-10"]);
  });

  it("months drawn at the DA rate in force are never re-priced (no blanket 12-month window)", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5000);
    await da(tenant, "2026-07-01", 5500);
    // July / August drawn at the 55% in force (delta review: the check is on the drawn DA value).
    await drawn(tenant, emp, "2026-07", { basic: 40000, da: 22000, hra: 12000 });
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000 });
    const out = await run(tenant, emp, "2026-09");
    expect(await raised(tenant, emp)).toEqual([]);
    expect(out.notDrawnPeriods).toEqual([]);
  });

  it("new rows are tagged source revision_dmd; legacy revision rows still count as drawn", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    await da(tenant, "2026-01-01", 5500);
    await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000 });
    await revision(tenant, emp, "2026-08-01", 40000, 42000);
    await run(tenant, emp, "2026-09");
    await run(tenant, emp, "2026-09");
    const r = await raised(tenant, emp);
    expect(r.map((x) => x.source)).toEqual(["revision_dmd"]);
  });
});

describe("T-STAT review SF3: the arrears step reads its inputs once per run", () => {
  async function seed(tenant: string, n: number): Promise<string[]> {
    await da(tenant, "2026-01-01", 5500);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const emp = randomUUID(); ids.push(emp);
      await drawn(tenant, emp, "2026-08", { basic: 40000, da: 22000, hra: 12000 });
      await revision(tenant, emp, "2026-08-01", 40000, 42000);
    }
    return ids;
  }

  it("prefetch is a constant number of queries for 3 or 20 employees; each employee then only writes its rows", async () => {
    const small = randomUUID(); const large = randomUUID();
    const smallIds = await seed(small, 3);
    const largeIds = await seed(large, 20);
    const pre = async (tenant: string, ids: string[]) => countAppQueries(() =>
      inTenant(tenant, (tx) => prefetchRetroArrearsTx(tx, tenant, ids, "2026-09")));
    const a = await pre(small, smallIds);
    const b = await pre(large, largeIds);
    expect(b.queryCount).toBe(a.queryCount);
    expect(b.queryCount).toBeLessThanOrEqual(8);

    // With the run prefetch, settling one employee issues exactly one INSERT (plus the tx wrapper).
    const prefetch = b.result;
    const per = await countAppQueries(() => inTenant(large, (tx) =>
      generateRetroArrears(tx, large, largeIds[0]!, "2026-09", "X", randomUUID(), undefined, { prefetch })));
    const empty = await countAppQueries(() => inTenant(large, async () => undefined));
    expect(per.queryCount - empty.queryCount).toBe(1);
    expect(rows(await raised(large, largeIds[0]!))).toEqual([["2026-08", "ARREAR", R(3700), R(3100)]]);
  });
});
