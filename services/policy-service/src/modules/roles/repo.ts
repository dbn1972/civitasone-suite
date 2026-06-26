import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { roles, permissions, type RoleRow, type RoleInsert, type PermRow, type PermInsert } from "./schema.js";
import type { RoleView, PermissionView } from "./domain.js";

function toRoleView(r: RoleRow): RoleView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, description: r.description ?? null, status: r.status, version: r.version };
}
function toPermView(r: PermRow): PermissionView {
  return { id: r.id, tenantId: r.tenantId, roleId: r.roleId, resource: r.resource, action: r.action, effect: r.effect as "allow" | "deny", version: r.version };
}

export async function findRoleById(id: string): Promise<RoleView | null> {
  const rows = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return rows[0] ? toRoleView(rows[0]) : null;
}

export async function findRolesByTenant(tenantId: string, limit = 500): Promise<RoleView[]> {
  return (await db.select().from(roles).where(eq(roles.tenantId, tenantId)).limit(limit)).map(toRoleView);
}

export async function findPermsByRole(roleId: string, limit = 500): Promise<PermissionView[]> {
  return (await db.select().from(permissions).where(eq(permissions.roleId, roleId)).limit(limit)).map(toPermView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRole(tx: Writer, row: RoleInsert): Promise<void> {
  await tx.insert(roles).values(row);
}
export async function updateRole(tx: Writer, id: string, patch: Partial<RoleInsert>): Promise<void> {
  await tx.update(roles).set({ ...patch, updatedAt: new Date() }).where(eq(roles.id, id));
}
export async function insertPermission(tx: Writer, row: PermInsert): Promise<void> {
  await tx.insert(permissions).values(row);
}
export async function findRoleByIdTx(tx: Writer, id: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles).where(eq(roles.id, id)).limit(1);
  return rows[0] ? toRoleView(rows[0]) : null;
}
