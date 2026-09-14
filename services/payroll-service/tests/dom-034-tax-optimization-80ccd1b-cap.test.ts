/**
 * DOM-034 — gap-routes.ts's tax-optimization advisor hardcoded the Sec
 * 80CCD(1B)/NPS suggestion headroom at Rs 50,000, in the exact same
 * function that DOM-026 already fixed to resolve sec80cCapMinor/
 * sec80dCapMinor via resolveRunStatutoryConfig() two lines above (real
 * Postgres, no mocks).
 *
 * Migration 0041 adds sec80ccd1b_cap_minor to statutory.statutory_config as
 * a third Chapter VI-A cap alongside sec80c_cap_minor/sec80d_cap_minor
 * (investigation writeup: migration 0041's own header, and the DOM-034 gap
 * report row -- in short, migration 0038's stated rationale for making
 * 80C/80D effective-dated/tenant-overridable was avoiding a code deploy on
 * a law change, not employer discretion, and that reasoning applies
 * identically to 80CCD(1B)).
 *
 * Unlike 80C/80D, 80CCD(1B) is not applied in any real tax computation in
 * this codebase (not computeSlip, not Form-16, not tax/routes.ts) -- only
 * this one advisory `suggestions` entry -- and payroll_tax_declarations has
 * no column to read a "used" 80CCD(1B) amount from, so `headroom` stays the
 * full resolved cap (matching the pre-fix route's own original semantics),
 * not cap-minus-used like the 80C/80D entries in the same array.
 *
 * Also fixed: the suggestion string itself independently hardcoded
 * "up to ₹50,000" a second time in the same object literal -- the same
 * dual-hardcode-in-one-handler bug class DOM-026 fixed for tax/routes.ts's
 * income-tax listing's `deductions80C` field. Removed (not interpolated),
 * matching the 80C/80D suggestion strings in this same array, neither of
 * which embeds a cap figure.
 *
 * Note: like DOM-026's own 80C case, the pre-fix hardcode (Rs 50,000) and
 * the platform default (Rs 50,000) are the SAME number, so a platform-
 * default run can't distinguish "reads config" from "still hardcoded".
 * The assertion below uses a tenant OVERRIDE cap that differs from both, so
 * a hardcoded site and a config-driven site provably diverge.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "70000000-d034-4000-8000-000000000001";
const TENANT = "90000000-d034-4000-8000-000000000001"; // gets its own sec80ccd1bCapMinor override
const OVERRIDE_CAP_MINOR = 8_000_000n; // Rs 80,000 -- differs from both the Rs 50,000 hardcode and the Rs 50,000 platform default
const OLD_HARDCODE_CAP_MINOR = 5_000_000n; // Rs 50,000 -- the pre-fix literal (== the platform default, see file header note)

function token(tenant: string, roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "dom034" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT}::uuid`);
  }));
}

async function seedOverrideConfig(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO statutory.statutory_config
        (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
         esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor,
         sec80ccd1b_cap_minor, created_by)
      VALUES (${TENANT}::uuid, '2025-01-01', 12, 1500000, 833, 125000, 2100000, 75, 325, 15000000, 7500000,
              ${OVERRIDE_CAP_MINOR}, ${ACTOR}::uuid)
    `);
  }));
}

describe("DOM-034 (0) -- sanity: platform default equals the pre-fix hardcode (so the route-level test below must use an override to be meaningful)", () => {
  it("DEFAULT_STATUTORY_CONFIG.sec80ccd1bCapMinor is Rs 50,000, matching the old hardcode", () => {
    expect(DEFAULT_STATUTORY_CONFIG.sec80ccd1bCapMinor).toBe(OLD_HARDCODE_CAP_MINOR);
  });
});

describe("DOM-034 (1) -- tax optimization advisor: tenant's 80CCD(1B) override honored, not the old Rs 50,000 hardcode", () => {
  it("GET /v1/payroll/tax/optimization resolves the tenant's overridden 80CCD(1B) cap as the suggestion headroom", async () => {
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
        const suggestion = body.suggestions.find((s: { section: string }) => s.section === "80CCD(1B)");
        expect(suggestion).toBeDefined();
        // The tenant's override (Rs 80,000 = 8,000,000 paise), not the
        // pre-fix Rs 50,000 (5,000,000 paise) hardcode.
        expect(suggestion.headroom).toBe(Number(OVERRIDE_CAP_MINOR));
        expect(suggestion.headroom).not.toBe(Number(OLD_HARDCODE_CAP_MINOR));
        // The suggestion text no longer embeds a second, independent
        // hardcode of the cap figure that could disagree with `headroom`
        // for an overridden tenant (see file header).
        expect(suggestion.suggestion).not.toMatch(/50,000|₹50000|5,00,00/);
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });

  it("GET /v1/payroll/tax/optimization falls back to the Rs 50,000 platform default when the tenant has no override", async () => {
    await cleanup();
    try {
      const app = await buildApp();
      try {
        const res = await app.inject({
          method: "GET",
          url: `/v1/payroll/tax/optimization?employeeId=${randomUUID()}`,
          headers: { authorization: `Bearer ${token(TENANT)}` },
        });
        expect(res.statusCode).toBe(200);
        const suggestion = res.json().suggestions.find((s: { section: string }) => s.section === "80CCD(1B)");
        expect(suggestion).toBeDefined();
        expect(suggestion.headroom).toBe(Number(OLD_HARDCODE_CAP_MINOR));
      } finally {
        await app.close();
      }
    } finally {
      await cleanup();
    }
  });
});
