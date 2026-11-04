/**
 * UAT T-PERIOD D-03 readiness script (scripts/uat-budget-readiness.ts), real Postgres: lists the expenditure heads a
 * tenant uses (90-day postings, payroll accrual mapping, open bills) with no budget provision for the current FY;
 * dry run writes nothing; --apply needs explicit tenants and inserts only missing BE = RE rows (idempotent).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { financeJournals, financeJournalLines } from "../src/modules/gl/schema.js";
import { currentFyIST, todayIST } from "../src/shared/ist-date.js";
import { budgetReadiness, suggestedAllocation, parseArgs } from "../scripts/uat-budget-readiness.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeSanctions } from "../src/modules/budget/schema.js";

const T = randomUUID();
const ACTOR = randomUUID();
const FY = currentFyIST();
const H = { edu: randomUUID(), med: randomUUID(), cash: randomUUID(), sal: randomUUID(), dep: randomUUID(), old: randomUUID(), bill: randomUUID(), jv: randomUUID(), san: randomUUID() };
const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(async () => { await pg.end({ timeout: 5 }); await sqlClient.end(); });
/** A posted, balanced journal: Dr `headId` / Cr cash, with its two denormalised lines. */
async function post(tx: any, headId: string, dr: bigint, postingDate: string, type = "journal") {
  const journalId = randomUUID();
  await tx.insert(financeJournals).values({
    id: journalId, tenantId: T, voucherNo: `RD-${journalId.slice(0, 8)}`, type, postingDate, status: "posted",
    lines: [{ accountCode: headId, debitMinor: dr.toString(), creditMinor: "0" }, { accountCode: H.cash, debitMinor: "0", creditMinor: dr.toString() }],
    createdBy: ACTOR, updatedBy: ACTOR,
  });
  await tx.insert(financeJournalLines).values([
    { tenantId: T, journalId, headId, debitMinor: dr, creditMinor: 0n, postingDate, journalType: type },
    { tenantId: T, journalId, headId: H.cash, debitMinor: 0n, creditMinor: dr, postingDate, journalType: type },
  ]);
}

beforeAll(async () => {
  await scoped(T, async (tx) => {
    await tx.insert(financeHeads).values([
      { id: H.edu, tenantId: T, code: "2202", name: "General Education", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.med, tenantId: T, code: "2210", name: "Medical", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.cash, tenantId: T, code: "1100", name: "Cash", level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.sal, tenantId: T, code: "5001", name: "Salary Expense", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.dep, tenantId: T, code: "5100", name: "Depreciation", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.old, tenantId: T, code: "2230", name: "Labour", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.bill, tenantId: T, code: "2235", name: "Social Security", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.jv, tenantId: T, code: "2245", name: "Natural Calamities", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
      { id: H.san, tenantId: T, code: "2401", name: "Crop Husbandry", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    // open work that the no-budget rule would refuse after deploy: an on-hold bill, a journal waiting for approval,
    // a sanction waiting for approval
    await tx.insert(financeBills).values({ tenantId: T, billNo: "RD-BILL-1", vendorId: randomUUID(), headId: H.bill, grossMinor: 250000n, netMinor: 250000n, status: "on_hold", createdBy: ACTOR, updatedBy: ACTOR });
    const pj = randomUUID();
    await tx.insert(financeJournals).values({ id: pj, tenantId: T, voucherNo: `DRAFT-${pj}`, type: "journal", postingDate: todayIST(), status: "pending_approval",
      lines: [{ accountCode: "2245", debitMinor: "330000", creditMinor: "0" }, { accountCode: "1100", debitMinor: "0", creditMinor: "330000" }], createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(financeSanctions).values({ tenantId: T, sanctionNo: "RD-SAN-1", purpose: "readiness", headId: H.san, amountMinor: 12345600n, status: "pending_approval", createdBy: ACTOR, updatedBy: ACTOR });
    const today = todayIST();
    await post(tx, H.edu, 900000n, today);                  // used, no provision -> listed
    await post(tx, H.med, 500000n, today);                  // used, HAS a provision -> not listed
    await post(tx, H.dep, 100000n, today, "depreciation");  // exempt journal type -> not counted
    await post(tx, H.old, 100000n, "2020-01-10");           // outside the 90 days, no other use -> not listed
    // (the cash head is debited nowhere and is an asset: never listed)
    await tx.insert(financeBudgets).values({ tenantId: T, headId: H.med, fy: FY, beMinor: 1n, reMinor: 1n, createdBy: ACTOR, updatedBy: ACTOR });
  });
});

describe("uat-budget-readiness", () => {
  it("suggests max(90-day spend annualised, open bills), rounded up to Rs 1,000, at least Rs 1,000", () => {
    expect(suggestedAllocation(900000n, 0n)).toBe(3700000n); // 9,000 x 365/90 = 36,500 -> 37,000
    expect(suggestedAllocation(0n, 12345600n)).toBe(12400000n);
    expect(suggestedAllocation(0n, 0n)).toBe(100000n);
  });
  it("dry run lists only the expenditure heads used without a provision, and writes nothing", async () => {
    const [r] = await budgetReadiness(pg, { apply: false, tenants: [T] });
    expect(r!.fy).toBe(FY);
    expect(r!.missing.map((m) => [m.code, m.sources])).toEqual([
      ["2202", ["postings_90d"]], ["2235", ["open_bills"]], ["2245", ["journals_pending"]], ["2401", ["sanctions_pending"]], ["5001", ["payroll_accrual"]],
    ]);
    const by = Object.fromEntries(r!.missing.map((m) => [m.code, m]));
    expect(by["2202"]!.suggestedMinor).toBe(3700000n);
    expect(by["2235"]).toMatchObject({ openBillsMinor: 250000n, suggestedMinor: 300000n });
    expect(by["2245"]).toMatchObject({ pendingJournalsMinor: 330000n, suggestedMinor: 400000n });
    expect(by["2401"]).toMatchObject({ pendingSanctionsMinor: 12345600n, suggestedMinor: 12400000n });
    expect(r!.payrollHeadsAbsent).toEqual(["5002"]);
    expect(r!.inserted).toEqual([]);
    const budgets = await scoped(T, (tx) => tx.select().from(financeBudgets).where(and(eq(financeBudgets.tenantId, T), eq(financeBudgets.fy, FY))));
    expect(budgets).toHaveLength(1);
  });
  it("--apply and --dry-run are mutually exclusive", () => {
    expect(parseArgs([]).apply).toBe(false);
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow(/mutually exclusive/);
  });
  it("--apply needs explicit tenants", async () => {
    await expect(budgetReadiness(pg, { apply: true })).rejects.toThrow(/explicit --tenant/);
  });
  it("--apply inserts the missing BE = RE rows once; a re-run finds nothing missing and inserts nothing", async () => {
    const [r] = await budgetReadiness(pg, { apply: true, tenants: [T] });
    expect(r!.inserted).toEqual(["2202", "2235", "2245", "2401", "5001"]);
    const [edu] = await scoped(T, (tx) => tx.select().from(financeBudgets).where(and(eq(financeBudgets.headId, H.edu), eq(financeBudgets.fy, FY))));
    expect(edu).toMatchObject({ beMinor: 3700000n, reMinor: 3700000n, utilisedMinor: 0n });
    const [again] = await budgetReadiness(pg, { apply: true, tenants: [T] });
    expect(again!.missing).toEqual([]);
    expect(again!.inserted).toEqual([]);
  });
});
