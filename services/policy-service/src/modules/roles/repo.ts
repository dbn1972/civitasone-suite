import { and, eq } from "drizzle-orm";
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
  await tx.insert(permissions).values(row).onConflictDoNothing({
    target: [permissions.tenantId, permissions.roleId, permissions.resource, permissions.action],
  });
}
export async function findRoleByIdTx(tx: Writer, id: string, tenantId: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).limit(1);
  return rows[0] ? toRoleView(rows[0]) : null;
}
