/**
 * Regression test — TX-010: sentinel-tenant defaults without a sentinel
 * SELECT policy.
 *
 * config.admin_feature_flags and health.admin_health_snapshots both default
 * tenant_id to the platform sentinel ('00000000-0000-0000-0000-000000000000')
 * but, before 0035_tx010_sentinel_select_policy.sql, carried only the
 * blanket all-commands tenant_isolation_policy
 * (tenant_id = current_tenant_id()), which never matches the sentinel for a
 * real tenant session — so platform-default rows were invisible to every
 * real tenant unless the reader manually switched app.tenant_id to the
 * sentinel value first (see modules/config/repo.ts's
 * runWithTenant(PLATFORM, ...) workaround, needed on every read).
 *
 * 0035_tx010_sentinel_select_policy.sql adds an additive, SELECT-only
 * permissive policy for the sentinel tenant_id on each table, without
 * loosening writes (same shape as asset-service 0023 / notification-service
 * 0045 / this service's own 0033).
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";

const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000";
const REAL_TENANT_A = "3aaaaaaa-0000-4000-8000-000000000001";
const REAL_TENANT_B = "3bbbbbbb-0000-4000-8000-000000000002";
const ACTOR = "3aaaaaaa-0000-4000-8000-0000000000aa";

const SENTINEL_FLAG_ID = "10100000-0000-4000-8000-000000000001";
const SENTINEL_SNAPSHOT_ID = "10100000-0000-4000-8000-000000000002";

async function seed() {
  await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
    tx.execute(sql`
      INSERT INTO config.admin_feature_flags
        (id, tenant_id, flag_key, enabled, overrides, created_by, updated_by)
      VALUES (${SENTINEL_FLAG_ID}, ${PLATFORM_TENANT}, 'tx010_test_platform_flag', true, '{}'::jsonb, ${ACTOR}, ${ACTOR})
      ON CONFLICT (tenant_id, flag_key) DO NOTHING
    `),
  );
  await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
    tx.execute(sql`
      INSERT INTO health.admin_health_snapshots
        (id, tenant_id, service_name, status, details, created_by, updated_by)
      VALUES (${SENTINEL_SNAPSHOT_ID}, ${PLATFORM_TENANT}, 'tx010-test-service', 'ok', '{}'::jsonb, ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `),
  );
}

describe("TX-010 — sentinel-tenant SELECT policy (admin-service)", () => {
  describe("config.admin_feature_flags", () => {
    it("a real tenant CAN read the platform-default feature flag without a GUC switch", async () => {
      await seed();
      const rows = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id, flag_key FROM config.admin_feature_flags WHERE id = ${SENTINEL_FLAG_ID}`),
      )) as unknown as Array<{ id: string; flag_key: string }>;
      expect(rows.length, "the platform-default feature flag must be visible to a real tenant session").toBe(1);
    });

    it("an ordinary tenant CANNOT write/tamper with the platform-default feature flag", async () => {
      await seed();
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`UPDATE config.admin_feature_flags SET enabled = false WHERE id = ${SENTINEL_FLAG_ID}`),
      );
      const rows = (await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
        tx.execute(sql`SELECT enabled FROM config.admin_feature_flags WHERE id = ${SENTINEL_FLAG_ID}`),
      )) as unknown as Array<{ enabled: boolean }>;
      expect(rows[0]?.enabled, "the platform default must be unmodified by an ordinary tenant's UPDATE").toBe(true);
    });

    it("tenant isolation for a tenant-owned feature flag is unaffected", async () => {
      const ownId = "10100000-0000-4000-8000-0000000000a1";
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`
          INSERT INTO config.admin_feature_flags
            (id, tenant_id, flag_key, enabled, overrides, created_by, updated_by)
          VALUES (${ownId}, ${REAL_TENANT_A}, 'tx010_test_tenant_flag', true, '{}'::jsonb, ${ACTOR}, ${ACTOR})
          ON CONFLICT (tenant_id, flag_key) DO NOTHING
        `),
      );
      const asOwner = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM config.admin_feature_flags WHERE id = ${ownId}`),
      )) as unknown as unknown[];
      expect(asOwner.length).toBe(1);

      const asOther = (await withTenantScope(db as never, REAL_TENANT_B, (tx: any) =>
        tx.execute(sql`SELECT id FROM config.admin_feature_flags WHERE id = ${ownId}`),
      )) as unknown as unknown[];
      expect(asOther.length, "tenant B must not see tenant A's private feature flag").toBe(0);
    });
  });

  describe("health.admin_health_snapshots", () => {
    it("a real tenant CAN read the platform-default health snapshot without a GUC switch", async () => {
      await seed();
      const rows = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM health.admin_health_snapshots WHERE id = ${SENTINEL_SNAPSHOT_ID}`),
      )) as unknown as unknown[];
      expect(rows.length, "the platform-default health snapshot must be visible to a real tenant session").toBe(1);
    });

    it("an ordinary tenant CANNOT write/tamper with the platform-default health snapshot", async () => {
      await seed();
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`UPDATE health.admin_health_snapshots SET status = 'tampered' WHERE id = ${SENTINEL_SNAPSHOT_ID}`),
      );
      const rows = (await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
        tx.execute(sql`SELECT status FROM health.admin_health_snapshots WHERE id = ${SENTINEL_SNAPSHOT_ID}`),
      )) as unknown as Array<{ status: string }>;
      expect(rows[0]?.status, "the platform default must be unmodified by an ordinary tenant's UPDATE").toBe("ok");
    });

    it("tenant isolation for a tenant-owned health snapshot is unaffected", async () => {
      const ownId = "10100000-0000-4000-8000-0000000000a2";
      await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`
          INSERT INTO health.admin_health_snapshots
            (id, tenant_id, service_name, status, details, created_by, updated_by)
          VALUES (${ownId}, ${REAL_TENANT_A}, 'tx010-test-tenant-service', 'ok', '{}'::jsonb, ${ACTOR}, ${ACTOR})
          ON CONFLICT (id) DO NOTHING
        `),
      );
      const asOwner = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
        tx.execute(sql`SELECT id FROM health.admin_health_snapshots WHERE id = ${ownId}`),
      )) as unknown as unknown[];
      expect(asOwner.length).toBe(1);

      const asOther = (await withTenantScope(db as never, REAL_TENANT_B, (tx: any) =>
        tx.execute(sql`SELECT id FROM health.admin_health_snapshots WHERE id = ${ownId}`),
      )) as unknown as unknown[];
      expect(asOther.length, "tenant B must not see tenant A's private health snapshot").toBe(0);
    });
  });
});
