import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { roles, permissions } from "../roles/schema.js";
import { roleBindings } from "../bindings/schema.js";

/**
 * Resolve a subject's active role UUIDs from their JWT role NAMES + any direct
 * user bindings. `abac.rules` key on role_id (uuid), while the token carries role
 * names — this bridges the two so ABAC rules actually match the subject.
 */
export async function resolveRoleIds(
  tenantId: string,
  userId: string,
  jwtRoleNames: string[],
): Promise<string[]> {
  const bindingRows = await db.select({ roleId: roleBindings.roleId })
    .from(roleBindings)
    .where(and(
      eq(roleBindings.tenantId, tenantId),
      eq(roleBindings.userId, userId),
      eq(roleBindings.status, "active"),
    ));
  const namedRoles = jwtRoleNames.length
    ? await db.select({ id: roles.id }).from(roles).where(and(
        eq(roles.tenantId, tenantId),
        eq(roles.status, "active"),
        inArray(roles.name, jwtRoleNames),
      ))
    : [];
  return [...new Set([
    ...bindingRows.map((r: { roleId: string }) => r.roleId),
    ...namedRoles.map((r: { id: string }) => r.id),
  ])];
}

export async function findGrantedPermissions(
  tenantId: string,
  userId: string,
  jwtRoleNames: string[],
): Promise<Array<{ resource: string; action: string; effect: string; roleName: string }>> {
  const bindingRows = await db.select({ roleId: roleBindings.roleId })
    .from(roleBindings)
    .where(and(
      eq(roleBindings.tenantId, tenantId),
      eq(roleBindings.userId, userId),
      eq(roleBindings.status, "active"),
    ));

  const boundRoleIds = bindingRows.map((r) => r.roleId);
  const namedRoles = jwtRoleNames.length
    ? await db.select().from(roles).where(and(
        eq(roles.tenantId, tenantId),
        eq(roles.status, "active"),
        inArray(roles.name, jwtRoleNames),
      ))
    : [];

  const roleIds = [...new Set([...boundRoleIds, ...namedRoles.map((r) => r.id)])];
  if (roleIds.length === 0) return [];

  const roleRows = await db.select().from(roles).where(inArray(roles.id, roleIds));
  const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));

  const permRows = await db.select().from(permissions).where(and(
    eq(permissions.tenantId, tenantId),
    inArray(permissions.roleId, roleIds),
  ));

  return permRows.map((p) => ({
    resource: p.resource,
    action: p.action,
    effect: p.effect,
    roleName: roleNameById.get(p.roleId) ?? "unknown",
  }));
}
