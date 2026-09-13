/**
 * DOM-026 — Section 80C deduction cap still hardcoded in three places, same
 * bug class DOM-008/DOM-020/DOM-025 already fixed for 80D (real Postgres,
 * no mocks).
 *
 * `payroll/gap-routes.ts`'s GET /v1/payroll/tax/optimization hardcoded
 * `cap80c` at Rs 1,50,000, two lines above this same function's
 * `resolveRunStatutoryConfig()` call (already fixed for `cap80d` by
 * DOM-025) -- the config object it already returns includes a sibling
 * `sec80cCapMinor` field that was simply never destructured. Independently,
 * `tax/routes.ts`'s GET /v1/payroll/income-tax and
 * GET /v1/payroll/tax/computation both hardcoded
 * `Math.min(Number(dec.section80c) / 100, 150000)` -- the same two routes
 * DOM-020 already fixed for 80D. A third, narrower hardcode of the same
 * 150000 literal also lived in GET /v1/payroll/income-tax's own
 * `deductions80C` response field (a second, independent occurrence in the
 * same handler, not called out in the gap's original filing but the same
 * bug class and fixed alongside the rest here -- otherwise the listing's
 * displayed "80C deductions" figure would disagree with the taxableIncome
 * it just computed for the same row). All four sites now resolve the same
 * effective-dated config (statutory.statutory_config) through
 * scopedRead() + resolveRunStatutoryConfig(), exactly like DOM-020/DOM-025.
 *
 * The payslip itself (domain.ts's computeSlip, via `sec80cCapMinor`) has
 * applied tenant-configured 80C correctly since DOM-008 -- covered below as
 * the parity baseline the other four sites must match, not as a fix.
 *
 * Note: unlike 80D (hardcode Rs 50,000 vs. platform default Rs 75,000 --
 * two different numbers), the pre-fix 80C hardcode (Rs 1,50,000) and the
 * platform default (Rs 1,50,000) are the SAME number, so a platform-default
 * run can't distinguish "reads config" from "still hardcoded". Every
 * assertion below therefore uses a tenant OVERRIDE cap that differs from
 * both, so a hardcoded site and a config-driven site provably diverge.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { computeSlip, DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "70000000-d026-4000-8000-000000000001";
const TENANT = "90000000-d026-4000-8000-000000000001"; // gets its own sec80cCapMinor override
const OVERRIDE_CAP_MINOR = 8_000_000n; // Rs 80,000 -- below both the Rs 1,50,000 hardcode and the Rs 1,50,000 platform default
const OLD_HARDCODE_CAP_MINOR = 15_000_000n; // Rs 1,50,000 -- the pre-fix literal in every site (== the platform default, see note above)
const DECLARED_80C_MINOR = 20_000_000n; // Rs 2,00,000 declared -- exceeds every candidate cap, so which cap wins is observable

function token(tenant: string, roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "dom026" }, SECRET);
}

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
      VALUES (${TENANT}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, ${OVERRIDE_CAP_MINOR}, 7500000, ${ACTOR}::uuid)
    `);
  }));
}

describe("DOM-026 (0) -- baseline: computeSlip (the payslip) already applies the tenant's overridden 80C cap", () => {
  it("computeSlip honors sec80cCapMinor, not a hardcoded literal (established by DOM-008, not touched by this fix)", () => {
    const declaration = { ded80cMinor: DECLARED_80C_MINOR };
    const basicMinor = 20_000_000n; // Rs 2,00,000/mo -- comfortably clears every candidate exemption

    const withOverride = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "old", fyStartYear: 2025,
      declaration, statutoryConfig: { ...DEFAULT_STATUTORY_CONFIG, sec80cCapMinor: OVERRIDE_CAP_MINOR },
    });
    const withPlatformDefault = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "old", fyStartYear: 2025,
      declaration, statutoryConfig: DEFAULT_STATUTORY_CONFIG,
    });

    // A lower 80C cap means less exemption, so MORE annual taxable income --
    // the difference is exactly the delta between the two caps (Rs 70,000).
    expect(DEFAULT_STATUTORY_CONFIG.sec80cCapMinor).toBe(OLD_HARDCODE_CAP_MINOR); // sanity: platform default == old hardcode, see file header note
    expect(withOverride.annualTaxableMinor - withPlatformDefault.annualTaxableMinor)
      .toBe(DEFAULT_STATUTORY_CONFIG.sec80cCapMinor - OVERRIDE_CAP_MINOR);
  });
});

describe("DOM-026 (1) -- tax optimization advisor: tenant's 80C override honored, not the old Rs 1,50,000 hardcode", () => {
  it("GET /v1/payroll/tax/optimization resolves the tenant's overridden cap", async () => {
    await cleanup();
    try {
      await seedOverrideConfig();

      const app = await buildApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: `/v1/payroll/tax/optimization?employeeId=${randomUUID()}`,
          headers: { authorization: `Bearer ${token(TENANT)}` },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        // No declaration seeded for this employee, so used80cMinor is 0 and
        // remaining80cMinor reflects the resolved cap directly -- the
        // tenant's override (Rs 80,000 = 8,000,000 paise), not the pre-fix
        // Rs 1,50,000 (15,000,000 paise) hardcode.
        expect(body.used80cMinor).toBe(0);
        expect(body.remaining80cMinor).toBe(Number(OVERRIDE_CAP_MINOR));
        expect(body.remaining80cMinor).not.toBe(Number(OLD_HARDCODE_CAP_MINOR));
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});

describe("DOM-026 (2) -- tax/routes.ts: both endpoints (+ the listing's own deductions80C field) honor the same tenant override, matching the payslip's cap", () => {
  it("GET /v1/payroll/income-tax and GET /v1/payroll/tax/computation both honor the same tenant override, matching the payslip's cap (was hardcoded 150000, ignoring it)", async () => {
    const employeeId = randomUUID();
    const runId = randomUUID();

    await cleanup();
    try {
      // Tenant-scoped statutory_config override -- DOM-008's mechanism, the
      // one these routes were silently ignoring.
      await seedOverrideConfig();
      await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values({
          id: runId, tenantId: TENANT, runNo: "DOM026-RUN", month: "2025-06",
          structureId: randomUUID(), totalGrossMinor: 20_000_000n, totalNetMinor: 18_000_000n,
          currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollSlips).values({
          id: randomUUID(), tenantId: TENANT, runId, employeeId, employeeNo: "DOM026-EMP",
          basicMinor: 10_000_000n, grossMinor: 20_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 18_000_000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(taxDeclarations).values({
          id: randomUUID(), tenantId: TENANT, employeeId, fy: "2025-26", regime: "old",
          section80c: DECLARED_80C_MINOR, section80d: 0n, hraClaimed: 0n, otherDeductions: 0n,
          status: "approved", createdBy: ACTOR,
        });
      }));

      // Expected, hand-derived exactly as tax/routes.ts computes it:
      // annualGross = Rs 2,00,000 (one slip); exemptions = min(200000, capRupees)
      // (80C) + 0 (80D) + 0 (HRA) + 0 (other) + stdDeduction("old", 2025) =
      // Rs 50,000 (setup-tax-config.ts's platform OLD config).
      const stdDeductionRupees = 50_000;
      const cappedAt = (capMinor: bigint) => Math.min(200_000, Number(capMinor) / 100);
      const expectedTaxableWithOverride = Math.round(Math.max(0, 200_000 - (cappedAt(OVERRIDE_CAP_MINOR) + stdDeductionRupees)) / 10) * 10;
      // What the OLD hardcode (Rs 1,50,000 cap) would have produced -- must
      // differ from the override result, or this test can't detect the bug.
      const expectedTaxableWithOldHardcode = Math.round(Math.max(0, 200_000 - (cappedAt(OLD_HARDCODE_CAP_MINOR) + stdDeductionRupees)) / 10) * 10;
      expect(expectedTaxableWithOverride).not.toBe(expectedTaxableWithOldHardcode);
      const expectedDeductions80C = cappedAt(OVERRIDE_CAP_MINOR);
      expect(expectedDeductions80C).not.toBe(cappedAt(OLD_HARDCODE_CAP_MINOR));

      const app = await buildApp();
      try {
        const auth = { authorization: `Bearer ${token(TENANT)}` };

        const computationRes = await app.inject({
          method: "GET", url: `/v1/payroll/tax/computation?employeeId=${employeeId}&fy=2025-26&regime=old`, headers: auth,
        });
        expect(computationRes.statusCode).toBe(200);
        expect(computationRes.json().taxableIncome).toBe(expectedTaxableWithOverride);

        const listingRes = await app.inject({
          method: "GET", url: "/v1/payroll/income-tax?fy=2025-26", headers: auth,
        });
        expect(listingRes.statusCode).toBe(200);
        const row = listingRes.json().data.find((d: { employee: string }) => d.employee === employeeId);
        expect(row).toBeDefined();
        expect(Number(row.taxableIncome)).toBe(expectedTaxableWithOverride);
        // The listing's own deductions80C field -- a second, independent
        // hardcode of the same 150000 literal in this same handler, fixed
        // alongside the rest here (see file header).
        expect(Number(row.deductions80C)).toBe(expectedDeductions80C);
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});
