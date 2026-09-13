/**
 * DOM-025 — 80D deduction cap still independently hardcoded in two more
 * places, missed by both DOM-008 and DOM-020 (real Postgres, no mocks except
 * the external HRMS identity boundary buildForm16 depends on -- the same
 * one-line stub tests/form16-pdf-coverage.test.ts and
 * tests/form16-bulk-routes.test.ts already use for that one external-network
 * boundary; DB, queue, and outbox stay real).
 *
 * `tax/form16.ts`'s computeForm16Deductions() (via buildForm16) and
 * `payroll/gap-routes.ts`'s GET /v1/payroll/tax/optimization each
 * independently hardcoded the Sec 80D cap at Rs 50,000, disagreeing with
 * domain.ts's config-driven sec80dCapMinor (DOM-008's platform default
 * Rs 75,000) and silently ignoring a tenant's override -- same bug class
 * DOM-020 already fixed in tax/routes.ts. Both now resolve the same
 * effective-dated config (statutory.statutory_config) through
 * scopedRead() + resolveRunStatutoryConfig(), exactly like DOM-020.
 *
 * Both sites read the SAME underlying declaration row: tax/schema.ts's
 * `taxDeclarations` Drizzle table IS payroll.payroll_tax_declarations, the
 * exact table gap-routes.ts's raw SQL queries.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { buildForm16 } from "../src/modules/tax/form16.js";

// External HRMS is not running in this service's isolated integration-test
// env. buildForm16's identity lookup (PAN/name for Form 16 Part A) is
// orthogonal to this gap's 80D-cap concern, so it is the one stubbed
// external-network boundary here -- same shape as the existing
// tests/form16-pdf-coverage.test.ts mock. DB, queue, and outbox stay real.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({ month: "2025-03", employees: [], lopDays: {} })),
  HrmsUnavailableError: class HrmsUnavailableError extends Error {
    readonly code = "HRMS_UNAVAILABLE";
  },
}));

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "70000000-d025-4000-8000-000000000001";
const TENANT = "90000000-d025-4000-8000-000000000001"; // gets its own sec80dCapMinor override
const OVERRIDE_CAP_MINOR = 4_000_000n; // Rs 40,000 -- below both the old Rs 50,000 hardcode and the Rs 75,000 platform default
const OLD_HARDCODE_CAP_MINOR = 5_000_000n; // Rs 50,000 -- the pre-fix literal in both sites

function token(tenant: string, roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "dom025" }, SECRET);
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
      VALUES (${TENANT}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, 15000000, ${OVERRIDE_CAP_MINOR}, ${ACTOR}::uuid)
    `);
  }));
}

describe("DOM-025 (1) -- Form 16: tenant's 80D override honored in Part B, not the old Rs 50,000 hardcode", () => {
  it("buildForm16 applies the tenant's overridden cap", async () => {
    const employeeId = randomUUID();
    const runId = randomUUID();
    const fy = "2025-26";

    await cleanup();
    try {
      await seedOverrideConfig();
      await runWithTenant(TENANT, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values({
          id: runId, tenantId: TENANT, runNo: "DOM025-RUN", month: "2025-06",
          structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
          currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(payrollSlips).values({
          id: randomUUID(), tenantId: TENANT, runId, employeeId, employeeNo: "DOM025-EMP",
          basicMinor: 10_000_000n, grossMinor: 20_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 18_000_000n, currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
        });
        await tx.insert(taxDeclarations).values({
          id: randomUUID(), tenantId: TENANT, employeeId, fy, regime: "old",
          section80c: 0n, section80d: 9_000_000n /* Rs 90,000 declared -- exceeds every candidate cap */,
          hraClaimed: 0n, otherDeductions: 0n, status: "approved", createdBy: ACTOR,
        });
      }));

      const result = await runWithTenant(TENANT, () => buildForm16(TENANT, employeeId, fy));

      // Hand-derived exactly as computeForm16Deductions computes it: gross
      // Rs 2,00,000 (one approved slip) - std deduction Rs 50,000 (old
      // regime, setup-tax-config.ts's platform config) - 80D capped at the
      // tenant's override (declared 90,000 exceeds it, so the cap binds).
      const grossSalary = 200_000;
      const stdDeductionRupees = 50_000;
      const declared80dRupees = 90_000;
      const capRupees = (capMinor: bigint) => Number(capMinor) / 100;
      const expectedTaxableWithOverride = Math.round(
        (grossSalary - stdDeductionRupees - Math.min(declared80dRupees, capRupees(OVERRIDE_CAP_MINOR))) / 10,
      ) * 10;
      // What the pre-fix hardcode would have produced -- must differ, or
      // this test can't detect the bug.
      const expectedTaxableWithOldHardcode = Math.round(
        (grossSalary - stdDeductionRupees - Math.min(declared80dRupees, capRupees(OLD_HARDCODE_CAP_MINOR))) / 10,
      ) * 10;
      expect(expectedTaxableWithOverride).not.toBe(expectedTaxableWithOldHardcode);

      expect(result.form16PartB.section80d).toBe(capRupees(OVERRIDE_CAP_MINOR));
      expect(result.form16PartB.section80d).not.toBe(capRupees(OLD_HARDCODE_CAP_MINOR));
      expect(result.form16PartB.taxableIncome).toBe(expectedTaxableWithOverride);
    } finally {
      await cleanup();
    }
  });
});

describe("DOM-025 (2) -- tax optimization advisor: tenant's 80D override honored, not the old Rs 50,000 hardcode", () => {
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
        // No declaration seeded for this employee, so used80dMinor is 0 and
        // remaining80dMinor reflects the resolved cap directly -- the
        // tenant's override (Rs 40,000 = 4,000,000 paise), not the pre-fix
        // Rs 50,000 (5,000,000 paise) hardcode.
        expect(body.used80dMinor).toBe(0);
        expect(body.remaining80dMinor).toBe(Number(OVERRIDE_CAP_MINOR));
        expect(body.remaining80dMinor).not.toBe(Number(OLD_HARDCODE_CAP_MINOR));
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});
