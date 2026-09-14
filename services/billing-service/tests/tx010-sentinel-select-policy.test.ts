/**
 * Regression test — TX-010: sentinel-tenant defaults without a sentinel
 * SELECT policy.
 *
 * plans.billing_plans and plans.billing_plan_features both default
 * tenant_id to the platform sentinel ('00000000-0000-0000-0000-000000000000')
 * but, before 0016_tx010_sentinel_select_policy.sql, carried only the
 * blanket all-commands tenant_isolation_policy
 * (tenant_id = plans.current_tenant_id()), which never matches the sentinel
 * for a real tenant session — so the platform plan catalogue was invisible
 * to every real tenant unless the reader manually switched app.tenant_id to
 * the sentinel value first (see modules/plans/repo.ts's SET_SYSTEM_TENANT
 * workaround, needed on every read).
 *
 * 0016_tx010_sentinel_select_policy.sql adds an additive, SELECT-only
 * permissive policy for the sentinel tenant_id on each table, without
 * loosening writes (same shape as asset-service 0023 / notification-service
 * 0045 / admin-service's own 0033).
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";

const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000";
const REAL_TENANT_A = "3aaaaaaa-0000-4000-8000-000000000001";
const REAL_TENANT_B = "3bbbbbbb-0000-4000-8000-000000000002";
const ACTOR = "3aaaaaaa-0000-4000-8000-0000000000aa";

const SENTINEL_PLAN_ID = "10100000-0000-4000-8000-000000000003";
const SENTINEL_PLAN_FEATURE_ID = "10100000-0000-4000-8000-000000000004";
const OWN_PLAN_ID = "10100000-0000-4000-8000-0000000000b1";

async function seed() {
  await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
    tx.execute(sql`
      INSERT INTO plans.billing_plans
        (id, tenant_id, name, code, price_minor, currency, created_by, updated_by)
      VALUES (${SENTINEL_PLAN_ID}, ${PLATFORM_TENANT}, 'TX-010 Test Plan', 'tx010-test-plan-sentinel', 0, 'INR', ${ACTOR}, ${ACTOR})
      ON CONFLICT (code) DO NOTHING
    `),
  );
  await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
    tx.execute(sql`
      INSERT INTO plans.billing_plan_features
        (id, tenant_id, plan_id, feature_key, limit_value, created_by, updated_by)
      VALUES (${SENTINEL_PLAN_FEATURE_ID}, ${PLATFORM_TENANT}, ${SENTINEL_PLAN_ID}, 'tx010_test_feature_sentinel', 10, ${ACTOR}, ${ACTOR})
      ON CONFLICT (plan_id, feature_key) DO NOTHING
    `),
  );
}

async function seedOwnPlan() {
  await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
    tx.execute(sql`
      INSERT INTO plans.billing_plans
        (id, tenant_id, name, code, price_minor, currency, created_by, updated_by)
      VALUES (${OWN_PLAN_ID}, ${REAL_TENANT_A}, 'Tenant A Custom Plan', 'tx010-test-plan-tenant-a', 5000, 'INR', ${ACTOR}, ${ACTOR})
      ON CONFLICT (code) DO NOTHING
    `),
  );
}

describe("TX-010 — sentinel-tenant SELECT policy (billing-service)", () => {
  describe("plans.billing_plans", () => {
    it("a real tenant CAN read the platform plan catalogue without a GUC switch", async () => {
      await seed();
      const rows = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id, code FROM plans.billing_plans WHERE id = ${SENTINEL_PLAN_ID}`),
      )) as unknown as Array<{ id: string; code: string }>;
      expect(rows.length, "the platform plan must be visible to a real tenant session").toBe(1);
    });

    it("an ordinary tenant CANNOT write/tamper with a platform plan", async () => {
      await seed();
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`UPDATE plans.billing_plans SET name = 'Tampered' WHERE id = ${SENTINEL_PLAN_ID}`),
      );
      const rows = (await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
        tx.execute(sql`SELECT name FROM plans.billing_plans WHERE id = ${SENTINEL_PLAN_ID}`),
      )) as unknown as Array<{ name: string }>;
      expect(rows[0]?.name, "the platform plan must be unmodified by an ordinary tenant's UPDATE").toBe("TX-010 Test Plan");
    });

    it("tenant isolation for a tenant-owned plan is unaffected", async () => {
      await seedOwnPlan();
      const asOwner = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM plans.billing_plans WHERE id = ${OWN_PLAN_ID}`),
      )) as unknown as unknown[];
      expect(asOwner.length).toBe(1);

      const asOther = (await withTenantScope(db as never, REAL_TENANT_B, (tx: any) =>
        tx.execute(sql`SELECT id FROM plans.billing_plans WHERE id = ${OWN_PLAN_ID}`),
      )) as unknown as unknown[];
      expect(asOther.length, "tenant B must not see tenant A's private plan").toBe(0);
    });
  });

  describe("plans.billing_plan_features", () => {
    it("a real tenant CAN read the platform plan's features without a GUC switch", async () => {
      await seed();
      const rows = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM plans.billing_plan_features WHERE id = ${SENTINEL_PLAN_FEATURE_ID}`),
      )) as unknown as unknown[];
      expect(rows.length, "the platform plan's feature row must be visible to a real tenant session").toBe(1);
    });

    it("an ordinary tenant CANNOT write/tamper with a platform plan feature", async () => {
      await seed();
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`UPDATE plans.billing_plan_features SET limit_value = 999999 WHERE id = ${SENTINEL_PLAN_FEATURE_ID}`),
      );
      const rows = (await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
        tx.execute(sql`SELECT limit_value FROM plans.billing_plan_features WHERE id = ${SENTINEL_PLAN_FEATURE_ID}`),
      )) as unknown as Array<{ limit_value: string | number }>;
      expect(Number(rows[0]?.limit_value), "the platform plan feature must be unmodified by an ordinary tenant's UPDATE").toBe(10);
    });

    it("tenant isolation for a tenant-owned plan feature is unaffected", async () => {
      await seedOwnPlan();
      const ownFeatureId = "10100000-0000-4000-8000-0000000000b2";
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`
          INSERT INTO plans.billing_plan_features
            (id, tenant_id, plan_id, feature_key, limit_value, created_by, updated_by)
          VALUES (${ownFeatureId}, ${REAL_TENANT_A}, ${OWN_PLAN_ID}, 'tx010_test_feature_tenant_a', 3, ${ACTOR}, ${ACTOR})
          ON CONFLICT (plan_id, feature_key) DO NOTHING
        `),
      );
      const asOwner = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM plans.billing_plan_features WHERE id = ${ownFeatureId}`),
      )) as unknown as unknown[];
      expect(asOwner.length).toBe(1);

      const asOther = (await withTenantScope(db as never, REAL_TENANT_B, (tx: any) =>
        tx.execute(sql`SELECT id FROM plans.billing_plan_features WHERE id = ${ownFeatureId}`),
      )) as unknown as unknown[];
      expect(asOther.length, "tenant B must not see tenant A's private plan feature").toBe(0);
    });
  });
});
