/**
 * DOM-020 — two adjacent statutory-calculation issues found reviewing
 * DOM-008, neither a parity regression, both pre-existing (real Postgres,
 * no mocks).
 *
 * (1) `insertEsi`'s persisted audit-log `erContribMinor` was recomputed from
 * the raw formula with no `roundRupee()`, while the authoritative slip
 * figure (`domain.ts`'s `computeSlip().esiEmployerMinor`) does round --
 * diverging for most gross amounts. Fixed by persisting
 * `result.esiEmployerMinor` directly instead of recomputing it.
 *
 * (2) `tax/routes.ts`'s own Sec 80D cap was independently hardcoded at
 * Rs 50,000 in two places, disagreeing with `domain.ts`'s config-driven
 * `sec80dCapMinor` (DOM-008's platform default Rs 75,000) -- a tenant's
 * override via `statutory.statutory_config` was honored in payroll TDS but
 * silently ignored by this route's own computation. Fixed by resolving the
 * same effective-dated config `domain.ts` uses.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollEsi } from "../src/modules/statutory/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { computeAndInsertSlip } from "../src/modules/payroll/consumer.js";
import { computeSlip, DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "70000000-d020-4000-8000-000000000001";

function token(tenant: string, roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "dom020" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("DOM-020 (1) -- ESI employer contribution: audit-log matches the slip exactly", () => {
  it("insertEsi's persisted erContribMinor equals computeSlip's rounded esiEmployerMinor, not the pre-fix unrounded formula", async () => {
    const tenant = randomUUID();
    const runId = randomUUID();
    const employeeId = randomUUID();

    // basicMinor chosen (city class X default -> 24% HRA, gross = basic*1.24)
    // so the ESI-employer raw formula lands on a non-rupee-multiple amount:
    // gross = Rs 11,160.00; raw = gross*325bps = 36,270 paise (Rs 362.70);
    // roundRupee -> 36,300 paise (Rs 363.00). The two values genuinely
    // differ, so this proves the DB row reflects the ROUNDED slip figure,
    // not the unrounded one insertEsi used to recompute pre-fix.
    const basicMinor = 900_000n;

    try {
      const result = await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values({
          id: runId, tenantId: tenant, runNo: "DOM020-RUN", month: "2025-06",
          structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
          currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
        });

        return computeAndInsertSlip(tx, { actorId: ACTOR }, {
          runId, tenantId: tenant, employeeId, employeeNo: "DOM020-EMP",
          basicMinor, month: "2025-06",
        });
      }));

      // Sabotage-check baked into the assertion itself: the naive pre-fix
      // formula and the correct rounded figure must actually differ for
      // this input, or the test would pass even with the bug present.
      const preFixUnrounded = (result.grossMinor * DEFAULT_STATUTORY_CONFIG.esiEmployerRateBps) / 10000n;
      expect(result.grossMinor).toBe(1_116_000n);
      expect(preFixUnrounded).toBe(36_270n);
      expect(result.esiEmployerMinor).toBe(36_300n);
      expect(preFixUnrounded).not.toBe(result.esiEmployerMinor);

      const esiRows = await runWithTenant(tenant, () => db.transaction((tx) =>
        tx.select().from(payrollEsi).where(and(eq(payrollEsi.tenantId, tenant), eq(payrollEsi.runId, runId), eq(payrollEsi.employeeId, employeeId)))));
      expect(esiRows).toHaveLength(1);
      // The literal DoD: the persisted audit-log figure equals the slip's
      // own rounded esiEmployerMinor, not the unrounded formula.
      expect(esiRows[0]!.erContribMinor).toBe(result.esiEmployerMinor);
      expect(esiRows[0]!.erContribMinor).not.toBe(preFixUnrounded);
    } finally {
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM statutory.payroll_esi WHERE tenant_id = ${tenant}::uuid`);
        await tx.execute(sql`DELETE FROM statutory.payroll_pf WHERE tenant_id = ${tenant}::uuid`);
        await tx.execute(sql`DELETE FROM statutory.payroll_nps WHERE tenant_id = ${tenant}::uuid`);
        await tx.execute(sql`DELETE FROM statutory.payroll_tds WHERE tenant_id = ${tenant}::uuid`);
        await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, tenant));
        await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenant));
      }));
    }
  });
});

describe("DOM-020 (2) -- Sec 80D cap: tenant override honored identically in the payslip and tax/routes.ts", () => {
  const TENANT_A = "90000000-d020-4000-8000-000000000001"; // gets its own sec80dCapMinor override
  const OVERRIDE_CAP_MINOR = 4_000_000n; // Rs 40,000 -- below both the old Rs 50,000 hardcode and the Rs 75,000 platform default
  const DECLARED_80D_MINOR = 9_000_000n; // Rs 90,000 declared -- exceeds every candidate cap, so which cap wins is observable

  async function cleanup(): Promise<void> {
    await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT_A}::uuid`);
      await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT_A));
      await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT_A));
      await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT_A));
    }));
  }

  it("computeSlip (the payslip) applies the tenant's overridden cap, not the platform default", async () => {
    const declaration = { ded80dMinor: DECLARED_80D_MINOR };
    const basicMinor = 20_000_000n; // Rs 2,00,000/mo -- comfortably clears every candidate exemption

    const withOverride = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "old", fyStartYear: 2025,
      declaration, statutoryConfig: { ...DEFAULT_STATUTORY_CONFIG, sec80dCapMinor: OVERRIDE_CAP_MINOR },
    });
    const withPlatformDefault = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "old", fyStartYear: 2025,
      declaration, statutoryConfig: DEFAULT_STATUTORY_CONFIG,
    });

    // A lower 80D cap means less exemption, so MORE annual taxable income --
    // the difference is exactly the delta between the two caps (Rs 35,000).
    expect(withOverride.annualTaxableMinor - withPlatformDefault.annualTaxableMinor)
      .toBe(DEFAULT_STATUTORY_CONFIG.sec80dCapMinor - OVERRIDE_CAP_MINOR);
  });

  it("GET /v1/payroll/income-tax and GET /v1/payroll/tax/computation both honor the same tenant override, matching the payslip's cap (was hardcoded 50000, ignoring it)", async () => {
    const employeeId = randomUUID();
    const runId = randomUUID();

    await cleanup();
    try {
      // Tenant-scoped statutory_config override -- DOM-008's mechanism, the
      // one this route was silently ignoring.
      await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO statutory.statutory_config
            (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
             esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
          VALUES (${TENANT_A}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, 15000000, ${OVERRIDE_CAP_MINOR}, ${ACTOR}::uuid)
        `);

        await tx.insert(payrollRuns).values({
          id: runId, tenantId: TENANT_A, runNo: "DOM020-80D-RUN", month: "2025-06",
          structureId: randomUUID(), totalGrossMinor: 20_000_000n, totalNetMinor: 18_000_000n,
          currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollSlips).values({
          id: randomUUID(), tenantId: TENANT_A, runId, employeeId, employeeNo: "DOM020-80D-EMP",
          basicMinor: 10_000_000n, grossMinor: 20_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 18_000_000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(taxDeclarations).values({
          id: randomUUID(), tenantId: TENANT_A, employeeId, fy: "2025-26", regime: "old",
          section80c: 0n, section80d: DECLARED_80D_MINOR, hraClaimed: 0n, otherDeductions: 0n,
          status: "approved", createdBy: ACTOR,
        });
      }));

      // Expected, hand-derived exactly as tax/routes.ts computes it:
      // annualGross = Rs 2,00,000 (one slip); exemptions = 0 (80C) +
      // min(90000, capRupees) (80D) + 0 (HRA) + 0 (other) + stdDeduction
      // ("old", 2025) = Rs 50,000 (setup-tax-config.ts's platform OLD config).
      const stdDeductionRupees = 50_000;
      const cappedAt = (capMinor: bigint) => Math.min(90_000, Number(capMinor) / 100);
      const expectedTaxableWithOverride = Math.round(Math.max(0, 200_000 - (cappedAt(OVERRIDE_CAP_MINOR) + stdDeductionRupees)) / 10) * 10;
      // What the OLD hardcode (Rs 50,000 cap) would have produced -- must
      // differ from the override result, or this test can't detect the bug.
      const OLD_HARDCODE_CAP_MINOR = 5_000_000n; // Rs 50,000
      const expectedTaxableWithOldHardcode = Math.round(Math.max(0, 200_000 - (cappedAt(OLD_HARDCODE_CAP_MINOR) + stdDeductionRupees)) / 10) * 10;
      expect(expectedTaxableWithOverride).not.toBe(expectedTaxableWithOldHardcode);

      const app = await buildApp();
      try {
        const auth = { authorization: `Bearer ${token(TENANT_A)}` };

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
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});
