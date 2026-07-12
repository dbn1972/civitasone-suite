import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import {
  roles, permissions, rolePermissions, roleAssignments,
  type RoleRow, type RoleInsert, type PermissionRow, type PermissionInsert,
} from "./schema.js";
import type { RoleView, PermissionView, EffectiveAccess } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

function roleToView(r: RoleRow): RoleView {
  return {
    id: r.id, tenantId: r.tenantId, key: r.key, name: r.name,
    description: r.description ?? null, isSystem: r.isSystem, version: r.version,
  };
}
function permToView(r: PermissionRow): PermissionView {
  return {
    id: r.id, tenantId: r.tenantId, key: r.key, name: r.name,
    description: r.description ?? null, version: r.version,
  };
}

// ── roles ────────────────────────────────────────────────────────────────
export async function findRoleById(tx: Writer, tenantId: string, id: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.id, id), eq(roles.tenantId, tenantId))).limit(1);
  return rows[0] ? roleToView(rows[0]) : null;
}
export async function findRoleByKey(tx: Writer, tenantId: string, key: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.key, key), eq(roles.tenantId, tenantId))).limit(1);
  return rows[0] ? roleToView(rows[0]) : null;
}
export async function listRoles(tenantId: string, limit: number, offset: number): Promise<RoleView[]> {
  const rows = await scopedRead((tx) => tx.select().from(roles)
    .where(eq(roles.tenantId, tenantId)).limit(limit).offset(offset));
  return rows.map(roleToView);
}
export async function insertRole(tx: Writer, row: RoleInsert): Promise<void> {
  await tx.insert(roles).values(row);
}

// ── permissions ────────────────────────────────────────────────────────────
export async function findPermissionById(tx: Writer, tenantId: string, id: string): Promise<PermissionView | null> {
  const rows = await tx.select().from(permissions)
    .where(and(eq(permissions.id, id), eq(permissions.tenantId, tenantId))).limit(1);
  return rows[0] ? permToView(rows[0]) : null;
}
export async function listPermissions(tenantId: string, limit: number, offset: number): Promise<PermissionView[]> {
  const rows = await scopedRead((tx) => tx.select().from(permissions)
    .where(eq(permissions.tenantId, tenantId)).limit(limit).offset(offset));
  return rows.map(permToView);
}
export async function insertPermission(tx: Writer, row: PermissionInsert): Promise<void> {
  await tx.insert(permissions).values(row);
}

// ── role <-> permission ──────────────────────────────────────────────────
/** Permission keys currently granted by a role. */
export async function permissionKeysForRole(tx: Writer, tenantId: string, roleId: string): Promise<string[]> {
  const rows = await tx.select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));
  return rows.map((r) => r.key);
}
export async function roleHasPermission(tx: Writer, tenantId: string, roleId: string, permissionId: string): Promise<boolean> {
  const rows = await tx.select({ id: rolePermissions.id }).from(rolePermissions)
    .where(and(
      eq(rolePermissions.tenantId, tenantId),
      eq(rolePermissions.roleId, roleId),
      eq(rolePermissions.permissionId, permissionId),
    )).limit(1);
  return rows.length > 0;
}
export async function attachPermission(tx: Writer, tenantId: string, roleId: string, permissionId: string, actorId: string): Promise<void> {
  await tx.insert(rolePermissions).values({ tenantId, roleId, permissionId, createdBy: actorId });
}
export async function detachPermission(tx: Writer, tenantId: string, roleId: string, permissionId: string): Promise<void> {
  await tx.delete(rolePermissions).where(and(
    eq(rolePermissions.tenantId, tenantId),
    eq(rolePermissions.roleId, roleId),
    eq(rolePermissions.permissionId, permissionId),
  ));
}

// ── role <-> user assignments ──────────────────────────────────────────────
export async function findAssignment(tx: Writer, tenantId: string, roleId: string, userId: string): Promise<{ id: string; status: string; version: number } | null> {
  const rows = await tx.select({ id: roleAssignments.id, status: roleAssignments.status, version: roleAssignments.version })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.roleId, roleId), eq(roleAssignments.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
export async function insertAssignment(tx: Writer, tenantId: string, roleId: string, userId: string, actorId: string): Promise<void> {
  await tx.insert(roleAssignments).values({ tenantId, roleId, userId, status: "active", createdBy: actorId, updatedBy: actorId });
}
/** Optimistic-locked status flip. */
export async function setAssignmentStatus(tx: Writer, tenantId: string, id: string, status: string, expectedVersion: number, actorId: string): Promise<number> {
  const res = await tx.update(roleAssignments)
    .set({ status, updatedBy: actorId, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(roleAssignments.id, id), eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.version, expectedVersion)))
    .returning({ id: roleAssignments.id });
  return res.length;
}

// ── effective access for a user ────────────────────────────────────────────
export async function effectiveAccess(tenantId: string, userId: string): Promise<EffectiveAccess> {
  const roleRows = await scopedRead((tx) => tx.select({ id: roles.id, key: roles.key, name: roles.name })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(
      eq(roleAssignments.tenantId, tenantId),
      eq(roleAssignments.userId, userId),
      eq(roleAssignments.status, "active"),
    )));
  const roleIds = roleRows.map((r) => r.id);
  let permKeys: string[] = [];
  if (roleIds.length > 0) {
    const permRows = await scopedRead((tx) => tx.selectDistinct({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(rolePermissions.tenantId, tenantId), inArray(rolePermissions.roleId, roleIds))));
    permKeys = permRows.map((r) => r.key);
  }
  return {
    userId, tenantId,
    roles: roleRows.map((r) => ({ id: r.id, key: r.key, name: r.name })),
    permissions: permKeys.sort(),
  };
}

/**
 * SEC C1 — tx-scoped re-derivation of a user's effective permission keys,
 * for apply-time authority re-checks inside the consumer transaction. Uses the
 * caller-supplied `tx` (Writer) so it reads the same snapshot the apply will
 * mutate; the caller is expected to have taken a row lock on the target role
 * (see lockRole) first so a concurrent permission change cannot race the check.
 */
export async function effectivePermissionKeys(tx: Writer, tenantId: string, userId: string): Promise<Set<string>> {
  const roleRows = await tx.select({ id: roleAssignments.roleId })
    .from(roleAssignments)
    .where(and(
      eq(roleAssignments.tenantId, tenantId),
      eq(roleAssignments.userId, userId),
      eq(roleAssignments.status, "active"),
    ));
  const roleIds = roleRows.map((r) => r.id);
  if (roleIds.length === 0) return new Set();
  // Plain select (the Set dedupes; Writer doesn't expose selectDistinct).
  const permRows = await tx.select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(rolePermissions.tenantId, tenantId), inArray(rolePermissions.roleId, roleIds)));
  return new Set(permRows.map((r: { key: string }) => r.key));
}

/**
 * SEC C1 — take a row lock on the target role inside the consumer tx so the
 * authority re-check + apply are serialized against concurrent permission
 * grants/revokes on that role. Returns the locked role's key, or null if absent.
 */
export async function lockRole(tx: Writer, tenantId: string, roleId: string): Promise<RoleView | null> {
  const rows = await tx.select().from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    .limit(1)
    .for("update");
  return rows[0] ? roleToView(rows[0]) : null;
}
