/**
 * DOM-008 (completing #1117) — payroll.tax_slab_config end-to-end (real
 * Postgres, no mocks).
 *
 * PR #1117 made PF/EPS/ESI/std-deduction/80C/80D config-driven and
 * tenant-overridable via statutory.statutory_config, but explicitly left
 * this gap's own original evidence unaddressed: tax_slab_config (FY-versioned
 * income-tax slabs / surcharge bands / 87A rebate / std deduction, read by
 * tax/engine.ts) had no tenant_id column — a single global row per
 * (fy_start_year, regime). Migration 0039 adds tenant_id (sentinel-zero-UUID
 * platform-default convention, mirroring migration 0038 exactly) and three
 * RLS policies; engine.ts's REGISTRY key becomes
 * `${tenantId}:${regime}:${startYear}` with tenant-first/platform-default
 * fallback resolution in getTaxConfig().
 *
 * This proves the literal DoD ("changing a cap without a deploy changes the
 * computed slip") for tax_slab_config specifically: loadTaxConfig() (the
 * real boot-time loader, via scopedPlatformRead()/app.platform_bypass) picks
 * up a freshly-inserted tenant override row through real RLS, and
 * computeTax()/computeSlip() reflect it for that tenant only — with one full
 * tax computation hand-verified against an independent, by-hand
 * reimplementation of the slab/rebate/surcharge/cess formula (same rigor as
 * PR #1117's parity proof).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { loadTaxConfig } from "../src/modules/tax/config.js";
import { computeTax, PLATFORM_DEFAULT_TENANT_ID } from "../src/modules/tax/engine.js";
import { computeSlip } from "../src/modules/payroll/domain.js";

const TENANT_A = "90000000-d008-4000-8000-000000000101"; // gets its own FY2025/new override
const TENANT_B = "90000000-d008-4000-8000-000000000102"; // no override -> platform default

// Exact FY2025 'new' regime platform-default slabs seeded by migration 0012
// (unchanged by migration 0039 — only the column shape changed).
const PLATFORM_2025_NEW_SLABS = [
  { from: 0, to: 400000, rate: 0 },
  { from: 400000, to: 800000, rate: 0.05 },
  { from: 800000, to: 1200000, rate: 0.10 },
  { from: 1200000, to: 1600000, rate: 0.15 },
  { from: 1600000, to: 2000000, rate: 0.20 },
  { from: 2000000, to: 2400000, rate: 0.25 },
  { from: 2400000, to: null, rate: 0.30 },
];
const PLATFORM_2025_NEW_SURCHARGE = [
  { above: 5000000, rate: 0.10 },
  { above: 10000000, rate: 0.15 },
  { above: 20000000, rate: 0.25 },
  { above: 50000000, rate: 0.25 },
];

// TENANT_A's override: identical shape, EXCEPT the top (open-ended) bracket
// drops from 30% to 25% -- a genuine tax-slab-bracket override, the literal
// evidence this gap cites (tax/schema.ts's slabs column).
const TENANT_A_SLABS = PLATFORM_2025_NEW_SLABS.map((s) => (s.to === null ? { ...s, rate: 0.25 } : s));

async function insertTaxSlabRow(tenantId: string, slabs: typeof PLATFORM_2025_NEW_SLABS): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.tax_slab_config
        (tenant_id, fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands)
      VALUES (
        ${tenantId}::uuid, 2025, 'new', ${JSON.stringify(slabs)}::jsonb,
        75000, 1200000, 60000, ${JSON.stringify(PLATFORM_2025_NEW_SURCHARGE)}::jsonb
      )
    `);
  }));
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT_A}::uuid`);
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT_B}::uuid`);
  }));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DOM-008 — tax_slab_config platform default (real DB, real RLS)", () => {
  it("migration 0039's backfilled platform-default FY2025/new row loads via loadTaxConfig() and matches the pre-migration seed", async () => {
    await loadTaxConfig();
    // No tenantId -> resolves the platform-default sentinel row (migration
    // 0012's original seed, now tenant_id = PLATFORM_DEFAULT_TENANT_ID).
    const tax = computeTax(1_000_000, "new", 2025);
    // Taxable 10L is within the 87A rebate cap (<=12L) -> full rebate -> zero tax.
    expect(tax.totalTax).toBe(0);
  });

  it("a tenant with no override sees the platform-default row via the additive RLS read policy", async () => {
    await loadTaxConfig();
    const tax = computeTax(2_500_000, "new", 2025, TENANT_B);
    expect(tax.totalTax).toBe(343_200); // see hand-verification below
  });
});

describe("DOM-008 — tenant override changes the computed tax without a deploy (the literal DoD)", () => {
  it("inserting a tenant-specific tax_slab_config row changes the top-bracket rate for that tenant only, hand-verified", async () => {
    // Baseline: TENANT_A, no override yet -> platform default (30% top bracket).
    await loadTaxConfig();
    const before = computeTax(2_500_000, "new", 2025, TENANT_A);

    // Hand-verification of the platform-default result at taxable = 25,00,000
    // (well above the 12L rebate cap, well below the 50L surcharge threshold):
    //   0-4L@0%=0; 4-8L@5%=20,000; 8-12L@10%=40,000; 12-16L@15%=60,000;
    //   16-20L@20%=80,000; 20-24L@25%=1,00,000; 24-25L@30%=30,000
    //   baseTax = 20,000+40,000+60,000+80,000+1,00,000+30,000 = 3,30,000
    //   rebate: taxable(25L) > cap(12L) -> 0; surcharge: 25L < 50L band -> 0
    //   cess = round(3,30,000 * 0.04) = 13,200
    //   total = round((3,30,000 + 13,200)/10)*10 = 3,43,200
    expect(before.baseTax).toBe(330_000);
    expect(before.surcharge).toBe(0);
    expect(before.cess).toBe(13_200);
    expect(before.totalTax).toBe(343_200);

    // A config change, not a deploy: insert a tenant-specific override row
    // for TENANT_A only, dropping the top bracket from 30% to 25%.
    await insertTaxSlabRow(TENANT_A, TENANT_A_SLABS);
    await loadTaxConfig(); // "may be re-called to refresh after a config change" (config.ts)

    const after = computeTax(2_500_000, "new", 2025, TENANT_A);

    // Hand-verification of the override: only the top-bracket (24-25L)
    // portion changes, 30,000 -> 25,000 (1,00,000 @ 25% instead of 30%):
    //   baseTax = 20,000+40,000+60,000+80,000+1,00,000+25,000 = 3,25,000
    //   cess = round(3,25,000 * 0.04) = 13,000
    //   total = round((3,25,000 + 13,000)/10)*10 = 3,38,000
    expect(after.baseTax).toBe(325_000);
    expect(after.cess).toBe(13_000);
    expect(after.totalTax).toBe(338_000);
    expect(after.totalTax).toBeLessThan(before.totalTax);
    expect(before.totalTax - after.totalTax).toBe(5_200); // 1,00,000 * 5% * 1.04 cess

    // TENANT_B, never touched, is completely unaffected by TENANT_A's override
    // (proves the tenant_isolation_policy still scopes writes/reads correctly).
    const tenantBTax = computeTax(2_500_000, "new", 2025, TENANT_B);
    expect(tenantBTax.totalTax).toBe(343_200);

    // Omitting tenantId (the platform-default sentinel) is also unaffected.
    const platformTax = computeTax(2_500_000, "new", 2025, PLATFORM_DEFAULT_TENANT_ID);
    expect(platformTax.totalTax).toBe(343_200);
  });

  it("the override is reflected end-to-end in a computed payroll slip (computeSlip's taxTenantId)", async () => {
    await insertTaxSlabRow(TENANT_A, TENANT_A_SLABS);
    await loadTaxConfig();

    // Basic pay chosen so annualized taxable income clears the 24L top-bracket
    // threshold the override changes (gross = basic + 24% HRA, city class X,
    // DA 0; annualGross = basic*1.24*12): basic ₹2,00,000/mo -> gross/mo
    // ₹2,48,000 -> annualGross ₹29,76,000 -> taxable (less 75,000 std
    // deduction) = ₹29,01,000, comfortably past the 24,00,000 threshold where
    // TENANT_A's 25% override applies instead of the platform default's 30%.
    // The exact-figure case is already hand-verified at the computeTax level
    // above; this only needs to prove the override reaches a real slip.
    const basicMinor = 20_000_000n; // ₹2,00,000/mo basic (paise)
    const slipDefault = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "new", fyStartYear: 2025,
      taxTenantId: PLATFORM_DEFAULT_TENANT_ID,
    });
    const slipTenantA = computeSlip({
      basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "new", fyStartYear: 2025,
      taxTenantId: TENANT_A,
    });
    expect(slipTenantA.tdsMinor).toBeLessThan(slipDefault.tdsMinor);

    // Omitting taxTenantId entirely still defaults to the platform default,
    // byte-identical to slipDefault -- backward compatibility for every
    // pre-DOM-008 caller/test that doesn't pass it.
    const slipOmitted = computeSlip({ basicMinor, daRateBps: 0n, cityClass: "X", taxRegime: "new", fyStartYear: 2025 });
    expect(slipOmitted.tdsMinor).toBe(slipDefault.tdsMinor);
  });
});
