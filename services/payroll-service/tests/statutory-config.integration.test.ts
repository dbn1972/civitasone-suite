/**
 * DOM-008 — statutory.statutory_config end-to-end (real Postgres, no mocks).
 *
 * Proves the literal DoD ("changing a cap without a deploy changes the
 * computed slip") at the DB layer: resolveRunStatutoryConfig() (consumer.ts)
 * reads statutory.statutory_config through real RLS — a tenant's own rows via
 * the strict tenant_isolation_policy, the platform-default sentinel row via
 * the additive platform_default_read_policy (migration 0038, mirroring
 * notification-service migration 0045) — and resolveStatutoryConfig()
 * (domain.ts, pure) picks the effective-dated winner. Also proves the
 * platform-default row seeded by migration 0038 is visible and reads back
 * as byte-identical to DEFAULT_STATUTORY_CONFIG (the pre-DOM-008 hardcoded
 * values) so no existing tenant's payroll changes just from this migration
 * having run.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { resolveRunStatutoryConfig } from "../src/modules/payroll/consumer.js";
import { computeSlip, DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const TENANT_A = "90000000-d008-4000-8000-000000000001"; // has its own override
const TENANT_B = "90000000-d008-4000-8000-000000000002"; // no override -> platform default
const ACTOR = "00000000-0000-0000-0000-000000000099";

async function cleanup(): Promise<void> {
  // Deletes both TENANT_A's own rows (via RLS as that tenant) and leaves the
  // seeded platform-default row untouched — this suite never mutates it.
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT_A}::uuid`);
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM statutory.statutory_config WHERE tenant_id = ${TENANT_B}::uuid`);
  }));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DOM-008 — statutory_config platform default (real DB, real RLS)", () => {
  it("migration 0038's seeded platform-default row is byte-identical to DEFAULT_STATUTORY_CONFIG (parity)", async () => {
    const cfg = await runWithTenant(TENANT_B, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_B, "2025-06")));
    expect(cfg).toEqual(DEFAULT_STATUTORY_CONFIG);
  });

  it("a tenant with no override sees the platform-default row via the additive RLS read policy", async () => {
    const cfg = await runWithTenant(TENANT_B, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_B, "2025-06")));
    expect(cfg.pfWageCapMinor).toBe(1_500_000n);
  });
});

describe("DOM-008 — tenant override changes the computed slip without a deploy (the literal DoD)", () => {
  it("inserting a tenant-specific statutory_config row changes PF for that tenant only", async () => {
    // Baseline: tenant A, no override yet -> platform default (₹15,000 PF wage cap).
    const before = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2025-06")));
    expect(before.pfWageCapMinor).toBe(1_500_000n);

    // A config change, not a deploy: insert an override row for tenant A only.
    await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO statutory.statutory_config
          (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
           esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
        VALUES (${TENANT_A}::uuid, '2025-01-01', 12, 2500000, 833, 208250, 2100000, 75, 325, 15000000, 7500000, ${ACTOR}::uuid)
      `);
    }));

    const after = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2025-06")));
    expect(after.pfWageCapMinor).toBe(2_500_000n); // ₹25,000 — the override, not the ₹15,000 default

    // Feed both resolved configs into computeSlip for a basic between the two
    // caps: the override must actually change the computed slip end to end.
    const basic = 2_000_000n; // ₹20,000 — above old cap, below new cap
    const slipBefore = computeSlip({ basicMinor: basic, daRateBps: 0n, statutoryConfig: before });
    const slipAfter = computeSlip({ basicMinor: basic, daRateBps: 0n, statutoryConfig: after });
    expect(slipAfter.pfEmployeeMinor).toBeGreaterThan(slipBefore.pfEmployeeMinor);
    expect(slipAfter.pfEmployeeMinor).toBe(240_000n); // 12% of ₹20,000 (uncapped under the ₹25,000 override)
    expect(slipBefore.pfEmployeeMinor).toBe(180_000n); // 12% of the ₹15,000 default cap

    // Tenant B, never touched, is completely unaffected by tenant A's override
    // (proves the tenant_isolation_policy still scopes writes/reads correctly).
    const tenantBCfg = await runWithTenant(TENANT_B, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_B, "2025-06")));
    expect(tenantBCfg.pfWageCapMinor).toBe(1_500_000n);
  });

  it("effective-dating: an override with a future effective_from is not used yet", async () => {
    await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO statutory.statutory_config
          (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
           esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
        VALUES (${TENANT_A}::uuid, '2030-04-01', 12, 3000000, 833, 249900, 2100000, 75, 325, 15000000, 7500000, ${ACTOR}::uuid)
      `);
    }));

    const cfgNow = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2025-06")));
    expect(cfgNow.pfWageCapMinor).toBe(1_500_000n); // future row not yet effective -> platform default

    const cfgFuture = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2030-05")));
    expect(cfgFuture.pfWageCapMinor).toBe(3_000_000n); // now on/after effective_from
  });

  it("effective-dating: two tenant rows -- the latest one on/before the period wins", async () => {
    await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO statutory.statutory_config
          (tenant_id, effective_from, pf_rate_pct, pf_wage_cap_minor, eps_rate_bps, eps_cap_minor,
           esi_wage_cap_minor, esi_employee_rate_bps, esi_employer_rate_bps, sec80c_cap_minor, sec80d_cap_minor, created_by)
        VALUES
          (${TENANT_A}::uuid, '2024-04-01', 12, 1800000, 833, 149940, 2100000, 75, 325, 15000000, 7500000, ${ACTOR}::uuid),
          (${TENANT_A}::uuid, '2025-04-01', 12, 2200000, 833, 183260, 2100000, 75, 325, 15000000, 7500000, ${ACTOR}::uuid)
      `);
    }));

    const midway = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2024-09")));
    expect(midway.pfWageCapMinor).toBe(1_800_000n); // only the 2024-04-01 row is on/before Sep 2024

    const later = await runWithTenant(TENANT_A, () => db.transaction((tx) => resolveRunStatutoryConfig(tx as unknown as typeof db, TENANT_A, "2025-09")));
    expect(later.pfWageCapMinor).toBe(2_200_000n); // both rows eligible; the later effective_from wins
  });
});
