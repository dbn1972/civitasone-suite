/**
 * Municipal role tenant provisioning from catalog.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, readScoped, sqlClient } from "../src/shared/db.js";
import { roles, permissions } from "../src/modules/roles/schema.js";
import { provisionMunicipalRolesForTenant, buildMunicipalRoleSeedSql } from "../src/modules/roles/municipal-provision.js";
import { listMunicipalRoleNames, MUNICIPAL_SERVICE_CATALOG } from "../src/modules/roles/municipal-catalog.js";

const TENANT = "aaaaaaaa-cccc-4000-8000-000000000099";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
// The idempotency test provisions real rows and doesn't tear them down
// (RLS-scoped deletes across two tables are more moving parts than this test
// needs) — a fixed tenant id would pick up leftover roles from a previous
// vitest run against the same long-lived DB, wrongly reporting rolesCreated
// as if the tenant already had roles. A fresh tenant id per test run is a
// clean slate regardless of what earlier runs left behind.
const PROVISION_TENANT = randomUUID();

afterAll(async () => {
  await sqlClient.end();
});

describe("municipal-provision", () => {
  it("catalog covers 17 services", () => {
    expect(MUNICIPAL_SERVICE_CATALOG).toHaveLength(17);
    expect(listMunicipalRoleNames().length).toBeGreaterThanOrEqual(50);
  });

  it("buildMunicipalRoleSeedSql emits INSERT for all catalog roles", () => {
    const sql = buildMunicipalRoleSeedSql(TENANT, ACTOR);
    const roleCount = listMunicipalRoleNames().length;
    expect(sql).toContain("INSERT INTO roles.roles");
    expect(sql).toContain(`(${roleCount} stubs)`);
    expect(sql).toContain("shop_user");
    expect(sql).toContain("market_admin");
    expect(sql).toContain("fire_inspector");
    expect(sql).toContain("ON CONFLICT (tenant_id, name) DO NOTHING");
    expect(sql.match(/'\w+_\w+'/g)?.length).toBeGreaterThanOrEqual(roleCount);
  });

  // Regression test for the bug this port fixed: provisionMunicipalRolesForTenant
  // used to re-check existing permissions via a read that was NOT on the
  // caller's transaction (repo.findPermsByRole uses its own readScoped tx),
  // so it never saw rows the same call had just inserted — both duplicating
  // permission rows and doing an O(n^2) re-scan per permission. This proves
  // the fix: calling the provisioning function twice for the same tenant
  // creates no duplicate rows, and the second call reports every role as
  // already-existing (rolesCreated === 0).
  it("is idempotent: calling twice creates no duplicate roles or permissions", async () => {
    const totalRoles = listMunicipalRoleNames().length;

    const first = await runWithTenant(PROVISION_TENANT, () =>
      db.transaction((tx) => provisionMunicipalRolesForTenant(tx, PROVISION_TENANT, ACTOR)),
    );
    expect(first.rolesCreated).toBe(totalRoles);
    expect(first.rolesSkipped).toBe(0);

    const second = await runWithTenant(PROVISION_TENANT, () =>
      db.transaction((tx) => provisionMunicipalRolesForTenant(tx, PROVISION_TENANT, ACTOR)),
    );
    expect(second.rolesCreated).toBe(0);
    expect(second.rolesSkipped).toBe(totalRoles);

    // Assert directly against the tables: exactly one row per role name, and
    // for every role, exactly one row per (resource, action) permission pair
    // — no duplicates from either provisioning call.
    //
    // Reads must go through readScoped (runWithTenant + db.transaction), same
    // as the writes above — RLS's tenant GUC is applied per-transaction (see
    // createTenantTxHook / PR #999), so a bare db.select() outside a
    // transaction runs with no tenant context and FORCE ROW LEVEL SECURITY
    // silently returns zero rows regardless of what's actually in the table.
    const roleRows = await readScoped(PROVISION_TENANT, (tx) =>
      tx.select().from(roles).where(eq(roles.tenantId, PROVISION_TENANT)),
    );
    expect(roleRows).toHaveLength(totalRoles);
    const roleNameCounts = new Map<string, number>();
    for (const r of roleRows) roleNameCounts.set(r.name, (roleNameCounts.get(r.name) ?? 0) + 1);
    for (const [name, count] of roleNameCounts) expect(count, `duplicate role row for ${name}`).toBe(1);

    for (const svc of MUNICIPAL_SERVICE_CATALOG) {
      for (const stub of svc.roles) {
        const role = roleRows.find((r) => r.name === stub.name);
        expect(role, `role ${stub.name} not provisioned`).toBeTruthy();
        const permRows = await readScoped(PROVISION_TENANT, (tx) =>
          tx.select().from(permissions).where(and(eq(permissions.tenantId, PROVISION_TENANT), eq(permissions.roleId, role!.id))),
        );
        const seen = new Set<string>();
        for (const p of permRows) {
          const key = `${p.resource}:${p.action}`;
          expect(seen.has(key), `duplicate permission ${key} for role ${stub.name}`).toBe(false);
          seen.add(key);
        }
        expect(permRows.length).toBe(stub.permissions.length);
      }
    }
  });
});
