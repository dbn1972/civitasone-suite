/**
 * Regression test — same RLS gap as notification-service's
 * templates.templates fix (fix/notification-rls-sentinel-template-read),
 * found here on register.asset_categories.
 *
 * 0006b_seed_default_categories.sql seeds two platform-wide default
 * categories ("IT Equipment", "Vehicle") with
 * tenant_id = '00000000-0000-0000-0000-000000000000', explicitly documented
 * as "default categories that internal consumers hard-code" — every real
 * tenant is expected to be able to read them. The active RLS policy on this
 * table (tenant_isolation_policy, from 0009_rls_full_tenant_isolation.sql)
 * only matched tenant_id = register.current_tenant_id(), so a real tenant's
 * queries silently returned 0 rows for both defaults.
 *
 * 0023_asset_categories_platform_wide_read.sql adds an additive,
 * SELECT-only permissive policy for the sentinel tenant_id, without
 * loosening writes.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";

const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000";
const REAL_TENANT_A = "3aaaaaaa-0000-4000-8000-000000000001";
const REAL_TENANT_B = "3bbbbbbb-0000-4000-8000-000000000002";
const IT_EQUIPMENT_ID = "77777777-0001-0000-0000-000000000001";

describe("register.asset_categories — platform-wide default read (RLS sentinel fix)", () => {
  it("a real tenant CAN read the platform-wide default categories", async () => {
    const rows = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
      tx.execute(sql`SELECT id, name FROM register.asset_categories WHERE id = ${IT_EQUIPMENT_ID}`),
    )) as unknown as Array<{ id: string; name: string }>;
    expect(rows.length, "platform-wide 'IT Equipment' category must be visible to a real tenant").toBe(1);
  });

  it("an ordinary tenant CANNOT write/tamper with a platform-wide default category", async () => {
    await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
      tx.execute(sql`UPDATE register.asset_categories SET name = 'Tampered' WHERE id = ${IT_EQUIPMENT_ID}`),
    );
    const rows = (await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
      tx.execute(sql`SELECT name FROM register.asset_categories WHERE id = ${IT_EQUIPMENT_ID}`),
    )) as unknown as Array<{ name: string }>;
    expect(rows[0]?.name, "the platform default must be unmodified by an ordinary tenant's UPDATE").toBe("IT Equipment");
  });

  it("tenant isolation for a tenant-owned category is unaffected", async () => {
    const customId = "3ccccccc-0002-4000-8000-000000000099";
    await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
      tx.execute(sql`
        INSERT INTO register.asset_categories
          (id, tenant_id, name, code, dep_method, dep_rate, useful_life_years, created_by, updated_by)
        VALUES (${customId}, ${REAL_TENANT_A}, 'Tenant A Custom', 'TAC', 'SLM', 10, 5, ${REAL_TENANT_A}, ${REAL_TENANT_A})
        ON CONFLICT (id) DO NOTHING
      `),
    );
    const asOwner = (await withTenantScope(db as never, REAL_TENANT_A, (tx: any) =>
      tx.execute(sql`SELECT id FROM register.asset_categories WHERE id = ${customId}`),
    )) as unknown as unknown[];
    expect(asOwner.length).toBe(1);

    const asOther = (await withTenantScope(db as never, REAL_TENANT_B, (tx: any) =>
      tx.execute(sql`SELECT id FROM register.asset_categories WHERE id = ${customId}`),
    )) as unknown as unknown[];
    expect(asOther.length, "tenant B must not see tenant A's private category").toBe(0);
  });
});
