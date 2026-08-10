/**
 * Tenant-scoped municipal role provisioning from MUNICIPAL_SERVICE_CATALOG.
 * Idempotent — skips roles that already exist for the tenant (by name).
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
      const existingPerms = await repo.findPermsByRole(roleId, tenantId, 500);
      const already = existingPerms.some((p) => p.resource === resource && p.action === action);
      if (already) continue;
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
