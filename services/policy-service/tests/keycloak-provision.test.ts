/**
 * Keycloak realm role tenant provisioning from catalog (Phase 1b RBAC
 * remediation). Structurally mirrors tests/municipal-provision.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, readScoped, sqlClient } from "../src/shared/db.js";
import { roles, permissions } from "../src/modules/roles/schema.js";
import { provisionKeycloakRolesForTenant } from "../src/modules/roles/keycloak-provision.js";
import { KEYCLOAK_REALM_ROLE_CATALOG, listKeycloakRoleNames } from "../src/modules/roles/keycloak-catalog.js";

const ACTOR = "00000000-cccc-4000-8000-000000000002";
// Fresh tenant id per run — same rationale as municipal-provision.test.ts:
// this test provisions real rows against a long-lived DB and doesn't tear
// them down, so a fixed tenant id would pick up an earlier run's leftovers.
const PROVISION_TENANT = randomUUID();

afterAll(async () => {
  await sqlClient.end();
});

describe("keycloak-provision", () => {
  it("catalog covers exactly the 7 real Keycloak realm roles", () => {
    expect(KEYCLOAK_REALM_ROLE_CATALOG).toHaveLength(7);
    expect(listKeycloakRoleNames()).toHaveLength(7);
  });

  // Regression-shaped test mirroring municipal-provision.test.ts: proves
  // calling the provisioning function twice for the same tenant creates no
  // duplicate rows, and the second call reports every role as
  // already-existing (rolesCreated === 0).
  it("is idempotent: calling twice creates no duplicate roles or permissions", async () => {
    const totalRoles = listKeycloakRoleNames().length;

    const first = await runWithTenant(PROVISION_TENANT, () =>
      db.transaction((tx) => provisionKeycloakRolesForTenant(tx, PROVISION_TENANT, ACTOR)),
    );
    expect(first.rolesCreated).toBe(totalRoles);
    expect(first.rolesSkipped).toBe(0);

    const second = await runWithTenant(PROVISION_TENANT, () =>
      db.transaction((tx) => provisionKeycloakRolesForTenant(tx, PROVISION_TENANT, ACTOR)),
    );
    expect(second.rolesCreated).toBe(0);
    expect(second.rolesSkipped).toBe(totalRoles);

    // Assert directly against the tables: exactly one row per role name, and
    // for every role, exactly one row per (resource, action) permission pair
    // — no duplicates from either provisioning call. Reads go through
    // readScoped (RLS tenant GUC), same as municipal-provision.test.ts.
    const roleRows = await readScoped(PROVISION_TENANT, (tx) =>
      tx.select().from(roles).where(eq(roles.tenantId, PROVISION_TENANT)),
    );
    expect(roleRows).toHaveLength(totalRoles);
    const roleNameCounts = new Map<string, number>();
    for (const r of roleRows) roleNameCounts.set(r.name, (roleNameCounts.get(r.name) ?? 0) + 1);
    for (const [name, count] of roleNameCounts) expect(count, `duplicate role row for ${name}`).toBe(1);

    for (const stub of KEYCLOAK_REALM_ROLE_CATALOG) {
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

    // super_admin, citizen, service_account should have zero permission rows
    // by design (see keycloak-catalog.ts) — assert this explicitly so a
    // future change to the catalog can't silently add rows for these without
    // a test noticing.
    for (const name of ["super_admin", "citizen", "service_account"]) {
      const role = roleRows.find((r) => r.name === name)!;
      const permRows = await readScoped(PROVISION_TENANT, (tx) =>
        tx.select().from(permissions).where(and(eq(permissions.tenantId, PROVISION_TENANT), eq(permissions.roleId, role.id))),
      );
      expect(permRows, `${name} should have zero permission rows`).toHaveLength(0);
    }
  });
});
