/**
 * GAP2-PAYROLL-TAX-CONFIG-01 (backend read for the Tax Configuration screen).
 *
 * GET /v1/payroll/tax/slab-config?fy= returns the tenant's EFFECTIVE income-tax
 * slab configuration (the same tenant-override-then-platform-default rows the
 * TDS engine applies), so the web page renders what payroll actually computes
 * rather than a hard-coded statutory copy. A tenant whose top-slab threshold
 * differs from the platform default (₹24,00,000) must see its own threshold.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { loadTaxConfig } from "../src/modules/tax/config.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const TENANT = randomUUID();
// A deliberately NON-default new-regime top-slab threshold (₹30,00,000),
// distinct from the platform-default ₹24,00,000, so a config-driven page
// provably diverges from the old hard-coded literal.
const OVERRIDE_TOP_FROM = 3_000_000;

const OVERRIDE_NEW_SLABS = [
  { from: 0, to: 400000, rate: 0 },
  { from: 400000, to: 800000, rate: 0.05 },
  { from: 800000, to: 1200000, rate: 0.10 },
  { from: 1200000, to: 1600000, rate: 0.15 },
  { from: 1600000, to: 2000000, rate: 0.20 },
  { from: 2000000, to: OVERRIDE_TOP_FROM, rate: 0.25 },
  { from: OVERRIDE_TOP_FROM, to: null, rate: 0.30 },
];
const SURCHARGE = [
  { above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 },
  { above: 20000000, rate: 0.25 }, { above: 50000000, rate: 0.37 },
];

function token(tenant: string, roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "gap2-slabcfg" }, SECRET);
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(sql`
    INSERT INTO payroll.tax_slab_config
      (tenant_id, fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands, created_by)
    VALUES
      (${TENANT}::uuid, 2025, 'new', ${JSON.stringify(OVERRIDE_NEW_SLABS)}::jsonb, 75000, 1200000, 60000, ${JSON.stringify(SURCHARGE)}::jsonb, ${ACTOR}::uuid)
    ON CONFLICT (tenant_id, fy_start_year, regime) DO UPDATE SET slabs = EXCLUDED.slabs
  `)));
  // Reload the engine registry so this override is resolvable (buildApp also
  // loads it, but make the seed deterministic regardless of ordering).
  await loadTaxConfig();
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT}::uuid`)));
  await sqlClient.end();
});

describe("GET /v1/payroll/tax/slab-config (GAP2-PAYROLL-TAX-CONFIG-01)", () => {
  it("returns the tenant's overridden new-regime top-slab threshold, not the platform-default ₹24,00,000", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/payroll/tax/slab-config?fy=2025-26",
      headers: { authorization: `Bearer ${token(TENANT)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fy).toBe("2025-26");
    expect(body.new).not.toBeNull();
    const topSlab = body.new.slabs[body.new.slabs.length - 1];
    expect(topSlab.to).toBeNull();
    expect(topSlab.from).toBe(OVERRIDE_TOP_FROM); // 30,00,000 — the seeded override
    expect(topSlab.from).not.toBe(2_400_000);     // not the hard-coded literal
    expect(topSlab.ratePct).toBe(30);
    // Surcharge bands + rebate are config-driven too.
    expect(body.new.surchargeBands.map((b: { ratePct: number }) => b.ratePct)).toEqual([10, 15, 25, 37]);
    expect(body.new.rebateMax).toBe(60000);
  });

  it("falls back to the platform default for a tenant with no override row", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/payroll/tax/slab-config?fy=2025-26",
      headers: { authorization: `Bearer ${token(randomUUID())}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const topSlab = body.new.slabs[body.new.slabs.length - 1];
    // Platform default FY2025-26 new-regime top slab starts at ₹24,00,000.
    expect(topSlab.from).toBe(2_400_000);
  });

  it("422s FY_NOT_CONFIGURED when neither regime is configured for the FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/payroll/tax/slab-config?fy=2099-00",
      headers: { authorization: `Bearer ${token(TENANT)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("FY_NOT_CONFIGURED");
  });

  it("403s a role not permitted to read tax config", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/payroll/tax/slab-config?fy=2025-26",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("401s with no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/tax/slab-config?fy=2025-26" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
