/**
 * UAT L2-N5: the arrears payable share of a drawn month reads the LOP days the LOP line records.
 *
 * From L2-N5 on, LOP also falls on HRA (and, for days out of service, on structure allowances), so the legacy
 * share 1 - LOP / (Basic + DA + DEP_ALLOW) would overstate the unpaid part of a month. A LOP line that carries
 * lopDays / daysInMonth gives the share exactly; an older line (no days) keeps the legacy formula. A month half
 * on LOP owes half the arrears either way.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { generateRetroArrears } from "../src/modules/payroll/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCTURE = randomUUID();
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

type Line = { code: string; type: "earning" | "deduction"; amountMinor: number; lopDays?: number; daysInMonth?: number };
async function seedDrawn(emp: string, month: string, lines: Line[]): Promise<void> {
  const runId = randomUUID();
  const tag = `DRAWN-${runId.slice(0, 8)}`;
  const gross = lines.filter((l) => l.type === "earning").reduce((s, l) => s + l.amountMinor, 0);
  const components = JSON.stringify(lines.map((l) => ({ name: l.code, ...l })));
  await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, ddo_code, status, created_by, updated_by)
    VALUES (${runId}::uuid, ${TENANT}::uuid, ${tag}, ${month}, ${STRUCTURE}::uuid, ${"regular"}, ${tag}, ${"disbursed"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  await q(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, net_pay_minor, components, status, created_by, updated_by)
    VALUES (${TENANT}::uuid, ${runId}::uuid, ${emp}::uuid, ${tag}, ${1400000}, ${gross}, ${gross}, ${components}::jsonb, ${"computed"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["payroll.payroll_arrears", "payroll.payroll_slips", "payroll.payroll_runs", "payroll.payroll_salary_revisions", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${TENANT}::uuid`).catch(() => undefined);
    }
  });
  await sqlClient.end();
});

// Revised 14,000 -> 16,000 from Nov 2026 (30 days); DA 55%; HRA X 30%. Per full month the arrear is
// (16,000 + 8,800 + 4,800) - (14,000 + 7,700 + 4,200) = 3,700; a month with 15 of 30 days on LOP owes 1,850.
const DRAWN: Line[] = [
  { code: "BASIC", type: "earning", amountMinor: 1400000 },
  { code: "DA", type: "earning", amountMinor: 770000 },
  { code: "HRA", type: "earning", amountMinor: 420000 },
];
async function arrearFor(lop: Line): Promise<string[]> {
  const emp = randomUUID();
  await q(sql`INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type)
    VALUES (${TENANT}::uuid, ${emp}::uuid, ${"2026-11-01"}, 1400000, 1600000, 0, 0, ${"annual_increment"})`);
  await seedDrawn(emp, "2026-11", [...DRAWN, lop]);
  await asTenant((tx) => generateRetroArrears(tx as unknown as typeof db, TENANT, emp, "2026-12", "X", ACTOR));
  const rows = await q(sql`SELECT difference_minor::text AS d FROM payroll.payroll_arrears WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid AND from_period = ${"2026-11"}`);
  return rows.map((r) => String(r.d));
}

describe("UAT L2-N5: arrears payable share and the LOP days on the drawn slip", () => {
  it("a LOP line recording its days (LOP on Basic + DA + HRA) owes exactly the paid share of the month", async () => {
    await q(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, ${"2026-01-01"}, 5500)`);
    // (14,000 + 7,700 + 4,200) x 15/30 = 12,950 -- the legacy ratio on Basic + DA alone would read it as 60% unpaid
    expect(await arrearFor({ code: "LOP", type: "deduction", amountMinor: 1295000, lopDays: 15, daysInMonth: 30 })).toEqual(["185000"]);
  });
  it("an older LOP line without days (LOP on Basic + DA only) keeps the legacy share", async () => {
    // (14,000 + 7,700) x 15/30 = 10,850
    expect(await arrearFor({ code: "LOP", type: "deduction", amountMinor: 1085000 })).toEqual(["185000"]);
  });
});
