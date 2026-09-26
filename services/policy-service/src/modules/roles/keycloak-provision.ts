/**
 * Tenant-scoped Keycloak realm role provisioning from
 * KEYCLOAK_REALM_ROLE_CATALOG. Idempotent — skips roles that already exist
 * for the tenant (by name), and relies on repo.insertPermission's
 * onConflictDoNothing guard (not a pre-check read) to make repeated
 * permission inserts safe no-ops. Structurally identical to
 * municipal-provision.ts's provisionMunicipalRolesForTenant — see that
 * file's comments for why the permission-insert path trusts the DB-level
 * conflict guard instead of a pre-check read.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { KEYCLOAK_REALM_ROLE_CATALOG } from "./keycloak-catalog.js";
import * as repo from "./repo.js";
import type { Writer } from "./repo.js";

export type KeycloakProvisionResult = {
  rolesCreated: number;
  permissionsCreated: number;
  rolesSkipped: number;
};

function deterministicId(tenantId: string, key: string): string {
  const hex = createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function provisionKeycloakRolesForTenant(
  tx: Writer,
  tenantId: string,
  actorId: string,
): Promise<KeycloakProvisionResult> {
  let rolesCreated = 0;
  let permissionsCreated = 0;
  let rolesSkipped = 0;

  for (const stub of KEYCLOAK_REALM_ROLE_CATALOG) {
    const existing = await repo.findRoleByNameTx(tx, tenantId, stub.name);
    const roleId = existing?.id ?? deterministicId(tenantId, `keycloak-role:${stub.name}`);

    if (existing) {
      rolesSkipped++;
    } else {
      await repo.insertRole(tx, {
        id: roleId,
        tenantId,
        name: stub.name,
        description: stub.description,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
        version: 1,
      });
      rolesCreated++;
    }

    for (const perm of stub.permissions) {
      const lastDot = perm.lastIndexOf(".");
      if (lastDot <= 0) continue;
      const resource = perm.slice(0, lastDot);
      const action = perm.slice(lastDot + 1);
      const permKey = `${stub.name}:${resource}:${action}`;
      const permId = deterministicId(tenantId, `keycloak-perm:${permKey}`);
      // Correctness relies solely on repo.insertPermission's
      // onConflictDoNothing guard (idx_permissions_tenant_role_resource_action)
      // — NOT on a pre-check read on `tx` — for the same reason
      // municipal-provision.ts does: a pre-check read on a different tx/scope
      // cannot see rows this same call just inserted, so it would both
      // duplicate and O(n^2)-rescan. permissionsCreated below counts
      // attempted inserts, not confirmed-new rows: on a repeat provisioning
      // call every attempt collapses to a harmless no-op, so this count
      // over-reports on a second run. That's fine — informational telemetry
      // only, never used for correctness.
      await repo.insertPermission(tx, {
        id: permId,
        tenantId,
        roleId,
        resource,
        action,
        effect: "allow",
        createdBy: actorId,
        updatedBy: actorId,
        version: 1,
      });
      permissionsCreated++;
    }
  }

  return { rolesCreated, permissionsCreated, rolesSkipped };
}

export function newKeycloakProvisionJobId(): string {
  return randomUUID();
}
