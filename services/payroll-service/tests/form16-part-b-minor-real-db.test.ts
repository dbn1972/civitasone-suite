/**
 * GAP-PAYROLL-RETURNS-06 -- buildForm16WithMinor() on a real Postgres.
 *
 * The 24Q Annexure II used to spread the display-rupee Form 16 Part B into a
 * payload whose TDS figures are paise, so Rs 35,000 read 35000 in one place and
 * 3500000 in another. Annexure II now takes buildForm16's EXACT paise
 * (`partBMinor`) instead of multiplying rupee Numbers back up by 100. This file
 * pins those paise against the real tables (slips, TDS rows, tax declaration,
 * statutory config; only the external HRMS identity lookup is stubbed, exactly
 * like dom-025-form16-and-tax-optimization-80d-cap.test.ts), and ties them to
 * the display-rupee Form 16 that the PDF and GET .../tax/form16 still return:
 * both are views of ONE computation.
 *
 * Slabs are the ones the suite registers (tests/setup-tax-config.ts, the
 * migration-0012 seed); every expected figure below is derived by hand from them.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollTds } from "../src/modules/statutory/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { buildForm16, buildForm16WithMinor, type Form16 } from "../src/modules/tax/form16.js";

vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({ month: "2026-03", employees: [], lopDays: {} })),
  HrmsUnavailableError: class HrmsUnavailableError extends Error {
    readonly code = "HRMS_UNAVAILABLE";
  },
}));

const ACTOR = "70000000-0b10-4000-8000-0000000b2606";
const TENANT = "90000000-0b10-4000-8000-0000000b2606";

// The old-regime case below declares amounts, which count before the tenant's
// proof cutoff (31 January of the FY); pin the clock before it, as dom-025 does.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-01-15T05:00:00Z"));

afterAll(async () => { await sqlClient.end(); });

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(payrollTds).where(eq(payrollTds.tenantId, TENANT));
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
}

/** The tenant's Sec 80C / 80D caps (Rs 1,50,000 / Rs 40,000): they bind only in the old regime. */
async function seedCaps(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO statutory.statutory_config
        (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
         esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
      VALUES (${TENANT}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, 15000000, 4000000, ${ACTOR}::uuid)
    `);
  }));
}

/**
 * A fresh employee with one approved run, slip and TDS row per entry of `slips`
 * (a month's gross and the TDS deducted on it, both in paise), and optionally a
 * tax declaration.
 */
async function seedEmployee(opts: {
  slips: Array<{ month: string; grossMinor: bigint; tdsMinor: bigint }>;
  declaration?: Partial<typeof taxDeclarations.$inferInsert> & { fy: string };
}): Promise<string> {
  const employeeId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const s of opts.slips) {
      const runId = randomUUID();
      const slipId = randomUUID();
      await tx.insert(payrollRuns).values({
        id: runId, tenantId: TENANT, runNo: `RET06-${runId.slice(0, 8)}`, month: s.month,
        structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
        currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(payrollSlips).values({
        id: slipId, tenantId: TENANT, runId, employeeId, employeeNo: "RET06-EMP",
        basicMinor: 0n, grossMinor: s.grossMinor, totalDeductionsMinor: 0n,
        netPayMinor: s.grossMinor, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(payrollTds).values({
        id: randomUUID(), tenantId: TENANT, slipId, employeeId, runId,
        tdsMinor: s.tdsMinor, period: s.month, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    if (opts.declaration) {
      await tx.insert(taxDeclarations).values({
        id: randomUUID(), tenantId: TENANT, employeeId, status: "approved", createdBy: ACTOR,
        ...opts.declaration,
      });
    }
  }));
  return employeeId;
}

/** Every `xMinor` paise figure is exactly 100x the display-rupee `x` of the Form 16 it was computed with. */
function expectTiedToRupeeView(form16: Form16, partBMinor: Record<string, unknown>) {
  const partB = form16.form16PartB as unknown as Record<string, unknown>;
  const keys = Object.keys(partBMinor).filter((k) => k !== "regime");
  expect(keys).toHaveLength(20);
  for (const k of keys) {
    const rupeeKey = k.replace(/Minor$/, "");
    expect(partB, rupeeKey).toHaveProperty(rupeeKey);
    expect(Number(partBMinor[k]) / 100, rupeeKey).toBe(partB[rupeeKey]);
  }
  expect(partBMinor.regime).toBe(partB.regime);
}

describe("GAP-PAYROLL-RETURNS-06: buildForm16WithMinor on a real DB", () => {
  it("new regime: Rs 35,000 TDS is 3,500,000 paise, and the whole Part B is exact paise", async () => {
    await cleanup();
    try {
      const employeeId = await seedEmployee({
        slips: [{ month: "2026-06", grossMinor: 150_000_000n, tdsMinor: 3_500_000n }], // Rs 15,00,000 gross, Rs 35,000 TDS
      });
      const { form16, partBMinor } = await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, employeeId, "2026-27"));

      // taxable = 15,00,000 - 75,000 = 14,25,000. Tax = 5% x 4,00,000 (20,000) + 10% x 4,00,000 (40,000)
      // + 15% x 2,25,000 (33,750) = 93,750; no 87A rebate (income above the Rs 12,00,000 cap), no
      // surcharge; cess 4% = 3,750; total 97,500; less TDS 35,000 = 62,500 still payable.
      expect(partBMinor).toEqual({
        grossSalaryMinor: 150_000_000n,
        perquisitesMinor: 0n,
        prevEmployerSalaryMinor: 0n,
        otherSourcesIncomeMinor: 0n,
        standardDeductionMinor: 7_500_000n,
        hraExemptMinor: 0n,
        section80cMinor: 0n,
        section80dMinor: 0n,
        otherDeductionsMinor: 0n,
        totalChapterViAMinor: 0n,
        taxableIncomeMinor: 142_500_000n,
        taxOnIncomeMinor: 9_375_000n,
        rebate87AMinor: 0n,
        surchargeMinor: 0n,
        cessMinor: 375_000n,
        totalTaxLiabilityMinor: 9_750_000n,
        totalTdsDeductedMinor: 3_500_000n,
        prevEmployerTdsMinor: 0n,
        balanceTaxPayableMinor: 6_250_000n,
        refundDueMinor: 0n,
        regime: "new",
      });
      expectTiedToRupeeView(form16, partBMinor as unknown as Record<string, unknown>);
      // The display-rupee Form 16 (PDF / GET .../tax/form16) is unchanged.
      expect(form16.form16PartB.totalTdsDeducted).toBe(35_000);
      expect(form16.form16PartB.totalTaxLiability).toBe(97_500);
      // ... and buildForm16 is exactly the form16 half.
      expect(await runWithTenant(TENANT, () => buildForm16(TENANT, employeeId, "2026-27"))).toEqual(form16);
    } finally {
      await cleanup();
    }
  });

  it("old regime: declared amounts are capped, a fractional-rupee perquisite stays exact paise, TDS rounds to the rupee", async () => {
    await cleanup();
    try {
      await seedCaps();
      const employeeId = await seedEmployee({
        slips: [
          { month: "2025-06", grossMinor: 60_000_000n, tdsMinor: 1_500_049n },  // Rs 6,00,000 gross, TDS Rs 15,000.49 (Q1)
          { month: "2025-12", grossMinor: 60_000_000n, tdsMinor: 2_000_000n },  // Rs 6,00,000 gross, TDS Rs 20,000.00 (Q3)
        ],
        declaration: {
          fy: "2025-26", regime: "old",
          section80c: 20_000_000n,        // Rs 2,00,000 declared -> capped at Rs 1,50,000
          section80d: 9_000_000n,         // Rs 90,000 declared   -> capped at the tenant's Rs 40,000
          hraClaimed: 0n, otherDeductions: 1_000_000n,              // Rs 10,000
          perquisitesMinor: 12_345n,      // Rs 123.45: not a whole rupee
        },
      });
      const { form16, partBMinor } = await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, employeeId, "2025-26"));

      // Chapter VI-A = 1,50,000 + 40,000 + 10,000 = 2,00,000. Taxable = 12,00,000 + 123.45 - 50,000 (std)
      // - 2,00,000 = 9,50,123.45 -> Sec 288A nearest Rs 10 = 9,50,120. Tax = 5% x 2,50,000 (12,500)
      // + 20% x 4,50,120 (90,024) = 1,02,524; no rebate, no surcharge; cess 4% = 4,100.96 -> 4,101;
      // total 1,06,625 -> Sec 288A nearest Rs 10 = 1,06,630. TDS 35,000.49 -> Rs 35,000; due 71,630.
      expect(partBMinor).toEqual({
        grossSalaryMinor: 120_000_000n,
        perquisitesMinor: 12_345n,
        prevEmployerSalaryMinor: 0n,
        otherSourcesIncomeMinor: 0n,
        standardDeductionMinor: 5_000_000n,
        hraExemptMinor: 0n,
        section80cMinor: 15_000_000n,
        section80dMinor: 4_000_000n,
        otherDeductionsMinor: 1_000_000n,
        totalChapterViAMinor: 20_000_000n,
        taxableIncomeMinor: 95_012_000n,
        taxOnIncomeMinor: 10_252_400n,
        rebate87AMinor: 0n,
        surchargeMinor: 0n,
        cessMinor: 410_100n,
        totalTaxLiabilityMinor: 10_663_000n,
        totalTdsDeductedMinor: 3_500_000n,
        prevEmployerTdsMinor: 0n,
        balanceTaxPayableMinor: 7_163_000n,
        refundDueMinor: 0n,
        regime: "old",
      });
      expectTiedToRupeeView(form16, partBMinor as unknown as Record<string, unknown>);
      expect(form16.form16PartB.perquisites).toBe(123.45);
    } finally {
      await cleanup();
    }
  });

  it("a refund is a positive refundDueMinor and a zero balanceTaxPayableMinor", async () => {
    await cleanup();
    try {
      const employeeId = await seedEmployee({
        slips: [{ month: "2026-06", grossMinor: 50_000_000n, tdsMinor: 3_500_000n }], // Rs 5,00,000 gross, Rs 35,000 deducted
      });
      const { form16, partBMinor } = await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, employeeId, "2026-27"));

      // taxable = 5,00,000 - 75,000 = 4,25,000; tax 5% x 25,000 = 1,250, wiped out by the 87A rebate: nil
      // liability, so the whole Rs 35,000 deducted comes back.
      expect(partBMinor.totalTaxLiabilityMinor).toBe(0n);
      expect(partBMinor.totalTdsDeductedMinor).toBe(3_500_000n);
      expect(partBMinor.balanceTaxPayableMinor).toBe(0n);
      expect(partBMinor.refundDueMinor).toBe(3_500_000n);
      expectTiedToRupeeView(form16, partBMinor as unknown as Record<string, unknown>);
    } finally {
      await cleanup();
    }
  });
});
