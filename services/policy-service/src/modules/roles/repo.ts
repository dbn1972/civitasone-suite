import { and, eq, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import { roles, permissions, type RoleRow, type RoleInsert, type PermRow, type PermInsert } from "./schema.js";
import type { RoleView, PermissionView } from "./domain.js";

function toRoleView(r: RoleRow): RoleView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, description: r.description ?? null, status: r.status, version: r.version };
}
function toPermView(r: PermRow): PermissionView {
  return { id: r.id, tenantId: r.tenantId, roleId: r.roleId, resource: r.resource, action: r.action, effect: r.effect as "allow" | "deny", version: r.version };
}

export async function findRoleById(id: string, tenantId: string): Promise<RoleView | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(roles)
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).limit(1));
  return rows[0] ? toRoleView(rows[0]) : null;
}

export async function findRolesByTenant(tenantId: string, limit = 500): Promise<RoleView[]> {
  return (await readScoped(tenantId, (tx) => tx.select().from(roles).where(eq(roles.tenantId, tenantId)).limit(limit))).map(toRoleView);
}

export async function findPermsByRole(roleId: string, tenantId: string, limit = 500): Promise<PermissionView[]> {
  return (await readScoped(tenantId, (tx) => tx.select().from(permissions)
    .where(and(eq(permissions.roleId, roleId), eq(permissions.tenantId, tenantId))).limit(limit))).map(toPermView);
}

/**
 * GAP-TENANT-ADMIN-ROLES-06: case-insensitive name lookup for the route's
 * duplicate pre-check. The DB unique index (tenant_id, name) is case-sensitive
 * and fires only inside the async consumer, so without this pre-check a duplicate
 * was 202-accepted and then silently failed.
 */
export async function findRoleByNameInsensitive(tenantId: string, name: string): Promise<RoleView | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(roles)
    .where(and(eq(roles.tenantId, tenantId), sql`lower(${roles.name}) = lower(${name})`)).limit(1));
  return rows[0] ? toRoleView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRole(tx: Writer, row: RoleInsert): Promise<void> {
  await tx.insert(roles).values(row);
}
export async function updateRole(tx: Writer, id: string, tenantId: string, patch: Partial<RoleInsert>): Promise<void> {
  await tx.update(roles).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId)));
}
export async function insertPermission(tx: Writer, row: PermInsert): Promise<void> {
  // idx_permissions_tenant_role_resource_action (migrations/0009) backs this:
  // a retried/duplicate addPermission command (e.g. a seed script re-POSTing
  // after a stale-read false negative) becomes a safe no-op instead of a
  // silent duplicate row, mirroring idx_roles_tenant_name's protection on
  // roles.roles below.
  // GAP-TENANT-ADMIN-ROLES-DETAIL-06: a repeat POST for an existing (role,
  // resource, action) used to be DROPPED (onConflictDoNothing), so flipping a
  // cell allow -> deny in the permission grid reported "saved" and changed
  // nothing. The route is an upsert of the cell's effect: an identical repeat
  // is still an idempotent no-op in effect, a different effect now takes hold.
  await tx.insert(permissions).values(row).onConflictDoUpdate({
    target: [permissions.tenantId, permissions.roleId, permissions.resource, permissions.action],
    set: { effect: row.effect ?? "allow", updatedBy: row.updatedBy, updatedAt: new Date(), version: sql`${permissions.version} + 1` },
  });
}
export async function findRoleByIdTx(tx: Writer, id: string, tenantId: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).limit(1);
  return rows[0] ? toRoleView(rows[0]) : null;
}

export async function findRoleByNameTx(tx: Writer, tenantId: string, name: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.name, name))).limit(1);
  return rows[0] ? toRoleView(rows[0]) : null;
}
