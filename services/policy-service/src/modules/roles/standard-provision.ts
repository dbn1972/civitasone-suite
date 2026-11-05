/**
 * POLICY-SEED-1: create the STANDARD roles and grants (standard-grants.ts) for one tenant, inside the caller's
 * transaction and tenant context (roles.* are FORCE RLS: run under runWithTenant(tenantId)).
 *
 * Idempotent and conservative: a role that already exists (by name) is reused, never changed; a grant that already
 * exists for (role, resource, action) is skipped WHATEVER its effect -- a tenant that set it to deny keeps its deny
 * (unlike repo.insertPermission, which upserts the effect for the permission grid). Ids are deterministic per
 * tenant, so two concurrent provisioners collide on the primary key instead of creating twins.
 * dryRun: report what would be created; write nothing.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as repo from "./repo.js";
import type { Writer } from "./repo.js";
import { permissions } from "./schema.js";
import { STANDARD_ROLE_GRANTS, STANDARD_ROLE_DESCRIPTION } from "./standard-grants.js";

export type StandardProvisionResult = {
  rolesCreated: string[];
  rolesExisting: string[];
  /** "role:resource.action" */
  grantsCreated: string[];
  grantsExisting: string[];
};

export function standardId(tenantId: string, key: string): string {
  const hex = createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function provisionStandardGrantsForTenant(
  tx: Writer, tenantId: string, actorId: string, opts: { dryRun?: boolean } = {},
): Promise<StandardProvisionResult> {
  const out: StandardProvisionResult = { rolesCreated: [], rolesExisting: [], grantsCreated: [], grantsExisting: [] };
  for (const [roleName, grants] of Object.entries(STANDARD_ROLE_GRANTS)) {
    const existing = await repo.findRoleByNameTx(tx, tenantId, roleName);
    const roleId = existing?.id ?? standardId(tenantId, `standard-role:${roleName}`);
    if (existing) out.rolesExisting.push(roleName);
    else {
      if (!opts.dryRun) {
        await repo.insertRole(tx, {
          id: roleId, tenantId, name: roleName, description: STANDARD_ROLE_DESCRIPTION, status: "active",
          createdBy: actorId, updatedBy: actorId, version: 1,
        });
      }
      out.rolesCreated.push(roleName);
    }
    for (const g of grants) {
      const label = `${roleName}:${g.resource}.${g.action}`;
      const have = existing
        ? await tx.select({ id: permissions.id }).from(permissions).where(and(
            eq(permissions.tenantId, tenantId), eq(permissions.roleId, roleId),
            eq(permissions.resource, g.resource), eq(permissions.action, g.action),
          )).limit(1)
        : [];
      if (have.length > 0) { out.grantsExisting.push(label); continue; }
      if (!opts.dryRun) {
        await tx.insert(permissions).values({
          id: standardId(tenantId, `standard-perm:${label}`), tenantId, roleId, resource: g.resource, action: g.action,
          effect: "allow", createdBy: actorId, updatedBy: actorId, version: 1,
        }).onConflictDoNothing();
      }
      out.grantsCreated.push(label);
    }
  }
  return out;
}
