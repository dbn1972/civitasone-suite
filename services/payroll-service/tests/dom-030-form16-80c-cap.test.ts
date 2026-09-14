/**
 * DOM-030 — form16.ts independently hardcodes its own Section 80C cap, same
 * bug class DOM-025 already fixed for 80D one line away in this exact
 * function (real Postgres, no mocks except the external HRMS identity
 * boundary buildForm16 depends on -- same one-line stub
 * tests/dom-025-form16-and-tax-optimization-80d-cap.test.ts and
 * tests/form16-pdf-coverage.test.ts already use for that one
 * external-network boundary; DB, queue, and outbox stay real).
 *
 * `tax/form16.ts`'s computeForm16Deductions() (via buildForm16) hardcoded
 * the Sec 80C cap at Rs 1,50,000 (CAP_80C_MINOR) unconditionally,
 * disagreeing with domain.ts's config-driven sec80cCapMinor (DOM-008) and
 * silently ignoring a tenant's override -- same bug class DOM-026 already
 * fixed in gap-routes.ts's tax-optimization advisor and tax/routes.ts's
 * income-tax/tax-computation endpoints. Now resolves the same
 * effective-dated config (statutory.statutory_config) through
 * scopedRead() + resolveRunStatutoryConfig(), destructuring the sibling
 * sec80cCapMinor field from the SAME call DOM-025 already made for
 * sec80dCapMinor in this function -- zero extra DB round-trips, exactly
 * mirroring DOM-026's fix pattern in gap-routes.ts.
 *
 * Note (same observation DOM-026's own test makes about its sites): unlike
 * 80D (hardcode Rs 50,000 vs. platform default Rs 75,000 -- two different
 * numbers), this file's pre-fix 80C hardcode (Rs 1,50,000, CAP_80C_MINOR)
 * and the platform default (Rs 1,50,000, DEFAULT_STATUTORY_CONFIG's
 * sec80cCapMinor) are the SAME number, so a platform-default run can't
 * distinguish "reads config" from "still hardcoded". This test therefore
 * seeds a tenant OVERRIDE cap that differs from both, so a still-hardcoded
 * site and a config-driven site provably diverge.
 *
 * Scope: this row's DoD is specifically Form-16 Part B output -- DOM-026
 * already covers the tax-optimization advisor and both tax/routes.ts
 * endpoints (see tests/dom-026-tax-routes-and-optimization-80c-cap.test.ts).
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { buildForm16 } from "../src/modules/tax/form16.js";

// External HRMS is not running in this service's isolated integration-test
// env. buildForm16's identity lookup (PAN/name for Form 16 Part A) is
// orthogonal to this gap's 80C-cap concern, so it is the one stubbed
// external-network boundary here -- same shape as DOM-025's own test and
// the existing tests/form16-pdf-coverage.test.ts mock. DB, queue, and
// outbox stay real.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({ month: "2025-03", employees: [], lopDays: {} })),
  HrmsUnavailableError: class HrmsUnavailableError extends Error {
    readonly code = "HRMS_UNAVAILABLE";
  },
}));

const ACTOR = "70000000-d030-4000-8000-000000000001";
const TENANT = "90000000-d030-4000-8000-000000000001"; // gets its own sec80cCapMinor override
const OVERRIDE_CAP_MINOR = 8_000_000n; // Rs 80,000 -- differs from both the Rs 1,50,000 hardcode and the Rs 1,50,000 platform default
const HARDCODE_AND_DEFAULT_CAP_MINOR = 15_000_000n; // Rs 1,50,000 -- what a still-hardcoded site (or an un-overridden default) would produce
const PLATFORM_DEFAULT_80D_CAP_MINOR = 7_500_000n; // Rs 75,000 -- DOM-008 default; not under test here, kept realistic
const DECLARED_80C_MINOR = 20_000_000n; // Rs 2,00,000 declared -- exceeds every candidate cap, so which cap wins is observable

afterAll(async () => { await sqlClient.end(); });

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
}

async function seedOverrideConfig(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO statutory.statutory_config
        (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
         esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
      VALUES (${TENANT}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, ${OVERRIDE_CAP_MINOR}, ${PLATFORM_DEFAULT_80D_CAP_MINOR}, ${ACTOR}::uuid)
    `);
  }));
}

describe("DOM-030 -- Form 16: tenant's 80C override honored in Part B, not the old Rs 1,50,000 hardcode", () => {
  it("buildForm16 applies the tenant's overridden 80C cap", async () => {
    const employeeId = randomUUID();
    const runId = randomUUID();
    const fy = "2025-26";

    await cleanup();
    try {
      await seedOverrideConfig();
      await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values({
          id: runId, tenantId: TENANT, runNo: "DOM030-RUN", month: "2025-06",
          structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
          currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollSlips).values({
          id: randomUUID(), tenantId: TENANT, runId, employeeId, employeeNo: "DOM030-EMP",
          basicMinor: 10_000_000n, grossMinor: 20_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 18_000_000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(taxDeclarations).values({
          id: randomUUID(), tenantId: TENANT, employeeId, fy, regime: "old",
          section80c: DECLARED_80C_MINOR, section80d: 0n,
          hraClaimed: 0n, otherDeductions: 0n, status: "approved", createdBy: ACTOR,
        });
      }));

      const result = await runWithTenant(TENANT, () => buildForm16(TENANT, employeeId, fy));

      // Hand-derived exactly as computeForm16Deductions computes it: gross
      // Rs 2,00,000 (one approved slip) - std deduction Rs 50,000 (old
      // regime) - 80C capped at the tenant's override (declared 2,00,000
      // exceeds it, so the cap binds).
      const grossSalary = 200_000;
      const stdDeductionRupees = 50_000;
      const declared80cRupees = 200_000;
      const capRupees = (capMinor: bigint) => Number(capMinor) / 100;
      const expectedTaxableWithOverride = Math.round(
        (grossSalary - stdDeductionRupees - Math.min(declared80cRupees, capRupees(OVERRIDE_CAP_MINOR))) / 10,
      ) * 10;
      // What a still-hardcoded (or un-overridden default) site would have
      // produced -- must differ, or this test can't detect the bug (see
      // the file-level note: the hardcode and the platform default are the
      // same number here, unlike 80D).
      const expectedTaxableWithHardcode = Math.round(
        (grossSalary - stdDeductionRupees - Math.min(declared80cRupees, capRupees(HARDCODE_AND_DEFAULT_CAP_MINOR))) / 10,
      ) * 10;
      expect(expectedTaxableWithOverride).not.toBe(expectedTaxableWithHardcode);

      expect(result.form16PartB.section80c).toBe(capRupees(OVERRIDE_CAP_MINOR));
      expect(result.form16PartB.section80c).not.toBe(capRupees(HARDCODE_AND_DEFAULT_CAP_MINOR));
      expect(result.form16PartB.taxableIncome).toBe(expectedTaxableWithOverride);
    } finally {
      await cleanup();
    }
  });
});
