/**
 * Tenant-scoped municipal role provisioning from MUNICIPAL_SERVICE_CATALOG.
 * Idempotent — skips roles that already exist for the tenant (by name), and
 * relies on repo.insertPermission's onConflictDoNothing guard (not a
 * pre-check read) to make repeated permission inserts safe no-ops.
 */
import { createHash, randomUUID } from "node:crypto";
import { MUNICIPAL_SERVICE_CATALOG, type MunicipalRoleStub } from "./municipal-catalog.js";
import * as repo from "./repo.js";
import type { Writer } from "./repo.js";

export type MunicipalProvisionResult = {
  rolesCreated: number;
  permissionsCreated: number;
  rolesSkipped: number;
};

function deterministicId(tenantId: string, key: string): string {
  const hex = createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function allRoleStubs(): MunicipalRoleStub[] {
  return MUNICIPAL_SERVICE_CATALOG.flatMap((s) => s.roles);
}

export async function provisionMunicipalRolesForTenant(
  tx: Writer,
  tenantId: string,
  actorId: string,
): Promise<MunicipalProvisionResult> {
  let rolesCreated = 0;
  let permissionsCreated = 0;
  let rolesSkipped = 0;

  for (const stub of allRoleStubs()) {
    const existing = await repo.findRoleByNameTx(tx, tenantId, stub.name);
    const roleId = existing?.id ?? deterministicId(tenantId, `municipal-role:${stub.name}`);

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
      const permId = deterministicId(tenantId, `municipal-perm:${permKey}`);
      // Correctness relies solely on repo.insertPermission's
      // onConflictDoNothing guard (idx_permissions_tenant_role_resource_action
      // — see repo.ts) — NOT on a pre-check read on `tx`. A pre-check read
      // was here before: it queried via repo.findPermsByRole(roleId,
      // tenantId, 500), which did not even take `tx`, so it ran outside this
      // transaction and could never see permissions this same call had just
      // inserted (transaction isolation) — meaning it both re-inserted
      // duplicates it thought were "new" AND re-scanned up to 500 rows once
      // per permission (O(n^2) over the whole provisioning run). Deleting
      // that read entirely and trusting the DB-level conflict guard fixes
      // both: correctness (impossible to duplicate a row) and complexity
      // (one insert attempt per permission, no reads).
      //
      // permissionsCreated below counts attempted inserts, not confirmed-new
      // rows: on a repeat provisioning call every attempt collapses to a
      // harmless no-op via onConflictDoNothing, so this count over-reports on
      // a second run. That's fine — it's informational telemetry in the
      // command result, never used for correctness.
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

/** SQL seed fragment for dev seed-all.mjs (deterministic UUIDs per dev tenant). */
export function buildMunicipalRoleSeedSql(tenantId: string, actorId: string): string {
  const lines: string[] = [];
  for (const stub of allRoleStubs()) {
    const roleId = deterministicId(tenantId, `municipal-role:${stub.name}`);
    const desc = stub.description.replace(/'/g, "''");
    lines.push(
      `  ('${roleId}', '${tenantId}', '${stub.name}', '${desc}', 'active', now(), now(), '${actorId}', '${actorId}', 1)`,
    );
  }
  return `-- Municipal Sec5 roles (${allRoleStubs().length} stubs)\nINSERT INTO roles.roles (id, tenant_id, name, description, status, created_at, updated_at, created_by, updated_by, version)\nVALUES\n${lines.join(",\n")}\nON CONFLICT (tenant_id, name) DO NOTHING;`;
}

export function newProvisionJobId(): string {
  return randomUUID();
}
