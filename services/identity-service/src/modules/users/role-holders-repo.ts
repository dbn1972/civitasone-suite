import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { users } from "./schema.js";
import { roles, roleAssignments } from "../rbac/schema.js";

/** One recipient of a role/desk notice: ids only, so a caller never learns more than it must. */
export interface RoleHolderRef {
  userId: string;
  tenantId: string;
}

export interface RoleHolderPage {
  data: RoleHolderRef[];
  /** The last user id of this page when more rows may follow, else null. */
  nextCursor: string | null;
}

function page(rows: RoleHolderRef[], limit: number): RoleHolderPage {
  const data = rows.slice(0, limit);
  return { data, nextCursor: rows.length > limit ? (data[data.length - 1]?.userId ?? null) : null };
}

/**
 * ACTIVE users of ONE tenant holding an ACTIVE assignment of any of these role keys. Keyset-paged on
 * the user id (stable under concurrent grants), one extra row read to know whether a next page exists.
 */
export async function tenantRoleHolders(tenantId: string, roleKeys: string[], limit: number, after: string | null): Promise<RoleHolderPage> {
  return scopedRead(async (tx) => {
    const rows = await tx.selectDistinct({ userId: users.id, tenantId: users.tenantId })
      .from(users)
      .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.tenantId, users.tenantId)))
      .innerJoin(roles, and(eq(roles.id, roleAssignments.roleId), eq(roles.tenantId, roleAssignments.tenantId)))
      .where(and(
        eq(users.tenantId, tenantId), eq(users.status, "active"),
        eq(roleAssignments.status, "active"), inArray(roles.key, roleKeys),
        ...(after ? [gt(users.id, after)] : []),
      ))
      .orderBy(asc(users.id)).limit(limit + 1);
    return page(rows, limit);
  });
}

/** Every ACTIVE user of one tenant (the tenant-wide broadcast audience), keyset-paged on the user id. */
export async function tenantActiveUsers(tenantId: string, limit: number, after: string | null): Promise<RoleHolderPage> {
  return scopedRead(async (tx) => {
    const rows = await tx.select({ userId: users.id, tenantId: users.tenantId })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), ...(after ? [gt(users.id, after)] : [])))
      .orderBy(asc(users.id)).limit(limit + 1);
    return page(rows, limit);
  });
}

/**
 * ACTIVE holders of a PLATFORM role across ALL tenants: platform operators live outside the tenant
 * whose event raised the notice. Read-only on the cross-tenant scanner pool (same contract as the
 * session reaper); callers must restrict roleKeys to the platform-authority keys.
 */
export async function platformRoleHolders(roleKeys: string[], limit: number, after: string | null): Promise<RoleHolderPage> {
  const rows = await scannerDb.selectDistinct({ userId: users.id, tenantId: users.tenantId })
    .from(users)
    .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.tenantId, users.tenantId)))
    .innerJoin(roles, and(eq(roles.id, roleAssignments.roleId), eq(roles.tenantId, roleAssignments.tenantId)))
    .where(and(
      eq(users.status, "active"), eq(roleAssignments.status, "active"), inArray(roles.key, roleKeys),
      ...(after ? [gt(users.id, after)] : []),
    ))
    .orderBy(asc(users.id)).limit(limit + 1);
  return page(rows, limit);
}
