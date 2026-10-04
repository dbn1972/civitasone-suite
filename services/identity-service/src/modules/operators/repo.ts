import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { users } from "../users/schema.js";
import { sessions } from "../sessions/schema.js";
import { roles, roleAssignments, rolePermissions, permissions, roleAssignmentHistory } from "../rbac/schema.js";
import { operatorChangeRequests as R, type OperatorRequestRow } from "./schema.js";
import { PLATFORM_ROLE_KEYS, primaryRoleKey, type OperatorState, type RequestKind, type RequestStatus } from "./domain.js";

type Tx = Pick<typeof db, "insert" | "update" | "select" | "delete">;
const PLATFORM = PLATFORM_ROLE_KEYS as unknown as string[];

export interface OperatorRecord extends OperatorState {
  name: string;
  email: string;
  mfaEnabled: boolean;
  version: number;
}

/** The ids of users holding an ACTIVE platform-authority role in this tenant. */
function operatorIdsQuery(tx: Tx, tenantId: string) {
  return tx.select({ id: roleAssignments.userId }).from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.status, "active"), inArray(roles.key, PLATFORM)));
}

export interface OperatorListRow {
  id: string;
  name: string;
  role: string;
  status: string;
  twoFaStatus: string;
  lastLogin: string;
  permissions: string[];
  version: number;
  pendingRequest: { id: string; kind: string; toRole: string | null; requestedBy: string } | null;
}

/** Operator directory page: stable order (name, id), bounded, with a total. */
export async function listOperators(tenantId: string, limit: number, offset: number): Promise<{ rows: OperatorListRow[]; total: number }> {
  return scopedRead(async (tx) => {
    const ids = operatorIdsQuery(tx as unknown as Tx, tenantId);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
    const page = await tx.select().from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, operatorIdsQuery(tx as unknown as Tx, tenantId))))
      .orderBy(asc(users.name), asc(users.id)).limit(limit).offset(offset);
    if (page.length === 0) return { rows: [], total: c?.n ?? 0 };
    const userIds = page.map((u) => u.id);
    const roleRows = await tx.select({ userId: roleAssignments.userId, roleId: roles.id, key: roles.key })
      .from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.status, "active"), inArray(roleAssignments.userId, userIds), inArray(roles.key, PLATFORM)));
    const roleIds = [...new Set(roleRows.map((r) => r.roleId))];
    const permRows = roleIds.length === 0 ? [] : await tx.select({ roleId: rolePermissions.roleId, key: permissions.key })
      .from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(rolePermissions.tenantId, tenantId), inArray(rolePermissions.roleId, roleIds)));
    const logins = await tx.select({ userId: sessions.userId, last: sql<Date | null>`max(${sessions.startedAt})` })
      .from(sessions).where(and(eq(sessions.tenantId, tenantId), inArray(sessions.userId, userIds))).groupBy(sessions.userId);
    const pending = await tx.select().from(R)
      .where(and(eq(R.tenantId, tenantId), eq(R.status, "pending"), inArray(R.targetUserId, userIds)));
    return {
      total: c?.n ?? 0,
      rows: page.map((u) => {
        const mine = roleRows.filter((r) => r.userId === u.id);
        const role = primaryRoleKey(mine.map((r) => r.key)) ?? "";
        const roleId = mine.find((r) => r.key === role)?.roleId;
        const last = logins.find((l) => l.userId === u.id)?.last;
        const p = pending.find((x) => x.targetUserId === u.id);
        return {
          id: u.id, name: u.name, role, status: u.status,
          twoFaStatus: u.mfaEnabled ? "enabled" : "disabled",
          lastLogin: last ? new Date(last).toISOString() : "",
          permissions: permRows.filter((x) => x.roleId === roleId).map((x) => x.key).sort(),
          version: u.version,
          pendingRequest: p ? { id: p.id, kind: p.kind, toRole: p.toRoleKey, requestedBy: p.requestedBy } : null,
        };
      }),
    };
  });
}

/**
 * One user's state whatever their status (a SUSPENDED operator keeps its active platform assignment, so it
 * is still recognised as an operator). roleKeys is empty for a user who holds no platform role.
 */
export async function loadAccount(tx: Tx, tenantId: string, userId: string, lock = false): Promise<OperatorRecord | null> {
  const q = tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId))).limit(1);
  const u = (lock ? await q.for("update") : await q)[0];
  if (!u) return null;
  const keys = await tx.select({ key: roles.key }).from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.status, "active"), eq(roleAssignments.userId, userId), inArray(roles.key, PLATFORM)));
  return { id: u.id, name: u.name, email: u.email, status: u.status, mfaEnabled: u.mfaEnabled, version: u.version, roleKeys: keys.map((k) => k.key) };
}

/** One operator's state (any status), or null when the user holds no active platform role. */
export async function loadOperator(tx: Tx, tenantId: string, userId: string, lock = false): Promise<OperatorRecord | null> {
  const a = await loadAccount(tx, tenantId, userId, lock);
  return a && a.roleKeys.length > 0 ? a : null;
}

export function loadAccountScoped(tenantId: string, userId: string): Promise<OperatorRecord | null> {
  return scopedRead((tx) => loadAccount(tx as unknown as Tx, tenantId, userId));
}

/** Pre-check read for the route (own RLS scope). */
export function loadOperatorScoped(tenantId: string, userId: string): Promise<OperatorRecord | null> {
  return scopedRead((tx) => loadOperator(tx as unknown as Tx, tenantId, userId));
}

/** How many ACTIVE users hold an active super_admin assignment. Take lockSuperAdminRole first when the answer gates a write. */
export async function countActiveSuperAdmins(tx: Tx, tenantId: string): Promise<number> {
  const [c] = await tx.select({ n: sql<number>`count(distinct ${users.id})::int` }).from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.status, "active"), eq(roles.key, "super_admin"), eq(users.status, "active"), eq(users.tenantId, tenantId)));
  return c?.n ?? 0;
}

/**
 * Serialises every change that can alter the super_admin head-count: take this
 * lock BEFORE counting, so two approvals racing to remove the last two super
 * admins run one after the other and the second sees the first's result.
 */
export async function lockSuperAdminRole(tx: Tx, tenantId: string): Promise<string | null> {
  const r = await tx.select({ id: roles.id }).from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "super_admin"))).limit(1).for("update");
  return r[0]?.id ?? null;
}

/** True when `userId` is an ACTIVE user holding an active super_admin assignment. */
export async function isActiveSuperAdmin(tx: Tx, tenantId: string, userId: string): Promise<boolean> {
  const op = await loadOperator(tx, tenantId, userId);
  return op !== null && op.status === "active" && op.roleKeys.includes("super_admin");
}

export async function isActivePlatformOperator(tx: Tx, tenantId: string, userId: string): Promise<boolean> {
  const op = await loadOperator(tx, tenantId, userId);
  return op !== null && op.status === "active";
}

export async function roleIdByKey(tx: Tx, tenantId: string, key: string): Promise<string | null> {
  const r = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.key, key))).limit(1);
  return r[0]?.id ?? null;
}

// ── requests ────────────────────────────────────────────────────────────────
export interface NewRequest {
  id: string; tenantId: string; kind: RequestKind; targetUserId: string; fromRoleKey: string;
  toRoleKey: string | null; reason: string; requestedBy: string;
}

/** Inserts a pending request; false when the operator already has one (partial unique index). */
export async function insertRequest(tx: Tx, r: NewRequest): Promise<boolean> {
  const rows = await tx.insert(R).values(r).onConflictDoNothing().returning({ id: R.id });
  return rows.length > 0;
}

export async function lockRequest(tx: Tx, tenantId: string, id: string): Promise<OperatorRequestRow | null> {
  const r = await tx.select().from(R).where(and(eq(R.tenantId, tenantId), eq(R.id, id))).limit(1).for("update");
  return r[0] ?? null;
}

/** pending -> terminal, race-safe: matches nothing when another decision won. */
export async function decideRequest(
  tx: Tx, tenantId: string, id: string, to: Exclude<RequestStatus, "pending">,
  by: string, note: string | null, extra: { refusalReason?: string; applied?: boolean; kcSync?: string } = {},
): Promise<boolean> {
  const rows = await tx.update(R).set({
    status: to, decidedBy: by, decidedAt: new Date(), decisionNote: note,
    ...(extra.refusalReason ? { refusalReason: extra.refusalReason } : {}),
    ...(extra.applied ? { appliedAt: new Date() } : {}),
    ...(extra.kcSync ? { kcSync: extra.kcSync } : {}),
    version: sql`${R.version} + 1`,
  }).where(and(eq(R.tenantId, tenantId), eq(R.id, id), eq(R.status, "pending"))).returning({ id: R.id });
  return rows.length > 0;
}

export async function setKcSync(tx: Tx, tenantId: string, id: string, kcSync: string): Promise<void> {
  await tx.update(R).set({ kcSync }).where(and(eq(R.tenantId, tenantId), eq(R.id, id)));
}

export interface RequestView {
  id: string; kind: string; targetUserId: string; targetName: string; fromRole: string; toRole: string | null;
  reason: string; status: string; requestedBy: string; requestedByName: string; requestedAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  refusalReason: string | null; kcSync: string | null;
}

export async function listRequests(tenantId: string, status: string | null, limit: number, offset: number): Promise<{ rows: RequestView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where = status ? and(eq(R.tenantId, tenantId), eq(R.status, status)) : eq(R.tenantId, tenantId);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(R).where(where);
    const rows = await tx.select().from(R).where(where).orderBy(desc(R.requestedAt), desc(R.id)).limit(limit).offset(offset);
    const ids = [...new Set(rows.flatMap((r) => [r.targetUserId, r.requestedBy, ...(r.decidedBy ? [r.decidedBy] : [])]))];
    const names = ids.length === 0 ? [] : await tx.select({ id: users.id, name: users.name }).from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
    const nm = (id: string | null) => (id ? names.find((n) => n.id === id)?.name ?? "Former user" : null);
    return {
      total: c?.n ?? 0,
      rows: rows.map((r) => ({
        id: r.id, kind: r.kind, targetUserId: r.targetUserId, targetName: nm(r.targetUserId) ?? "", fromRole: r.fromRoleKey, toRole: r.toRoleKey,
        reason: r.reason, status: r.status, requestedBy: r.requestedBy, requestedByName: nm(r.requestedBy) ?? "",
        requestedAt: r.requestedAt.toISOString(), decidedBy: r.decidedBy, decidedByName: nm(r.decidedBy),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null, decisionNote: r.decisionNote,
        refusalReason: r.refusalReason, kcSync: r.kcSync,
      })),
    };
  });
}

export interface CandidateRow { id: string; name: string; email: string }

/**
 * People who could be made operators: ACTIVE users of this tenant who hold no platform role, optionally
 * filtered by a name / e-mail search, in a stable order and a bounded page. The exclusion is done in SQL, so it
 * is complete however many operators there are.
 */
export async function listGrantCandidates(tenantId: string, q: string | null, limit: number): Promise<CandidateRow[]> {
  return scopedRead(async (tx) => {
    const needle = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const conds = [eq(users.tenantId, tenantId), eq(users.status, "active"), notInArray(users.id, operatorIdsQuery(tx as unknown as Tx, tenantId))];
    if (needle) conds.push(or(ilike(users.name, needle), ilike(users.email, needle))!);
    return tx.select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(and(...conds)).orderBy(asc(users.name), asc(users.id)).limit(limit);
  });
}

export function hasPendingScoped(tenantId: string, userId: string): Promise<boolean> {
  return scopedRead(async (tx) => (await tx.select({ id: R.id }).from(R)
    .where(and(eq(R.tenantId, tenantId), eq(R.targetUserId, userId), eq(R.status, "pending"))).limit(1)).length > 0);
}

export function findRequestScoped(tenantId: string, id: string): Promise<OperatorRequestRow | null> {
  return scopedRead(async (tx) => (await tx.select().from(R).where(and(eq(R.tenantId, tenantId), eq(R.id, id))).limit(1))[0] ?? null);
}

// ── effects (all inside the approving transaction) ──────────────────────────
export async function setUserStatus(tx: Tx, tenantId: string, userId: string, status: "active" | "suspended", actorId: string): Promise<void> {
  await tx.update(users).set({ status, updatedBy: actorId, updatedAt: new Date(), version: sql`${users.version} + 1` })
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
}

export async function revokeUserSessions(tx: Tx, tenantId: string, userId: string, actorId: string): Promise<string[]> {
  const rows = await tx.update(sessions).set({ status: "revoked", updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId), eq(sessions.status, "active")))
    .returning({ id: sessions.id });
  return rows.map((r) => r.id);
}

/** Moves the operator's platform role: revoke every active platform assignment, grant the new one. */
export async function changePlatformRole(tx: Tx, tenantId: string, userId: string, toRoleId: string, actorId: string, reason: string): Promise<void> {
  const current = await tx.select({ id: roleAssignments.id, roleId: roleAssignments.roleId, version: roleAssignments.version })
    .from(roleAssignments).innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.userId, userId), eq(roleAssignments.status, "active"), inArray(roles.key, PLATFORM)));
  for (const c of current) {
    if (c.roleId === toRoleId) continue;
    const n = await tx.update(roleAssignments).set({ status: "revoked", updatedBy: actorId, updatedAt: new Date(), version: c.version + 1 })
      .where(and(eq(roleAssignments.id, c.id), eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.version, c.version))).returning({ id: roleAssignments.id });
    if (n.length === 0) throw new Error("optimistic lock conflict on operator role change");
    await tx.insert(roleAssignmentHistory).values({ tenantId, roleId: c.roleId, userId, action: "revoke", actorId, reason });
  }
  const existing = await tx.select({ id: roleAssignments.id, status: roleAssignments.status, version: roleAssignments.version })
    .from(roleAssignments).where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.roleId, toRoleId), eq(roleAssignments.userId, userId))).limit(1);
  if (existing[0]) {
    if (existing[0].status !== "active") {
      await tx.update(roleAssignments).set({ status: "active", updatedBy: actorId, updatedAt: new Date(), version: existing[0].version + 1 })
        .where(and(eq(roleAssignments.id, existing[0].id), eq(roleAssignments.tenantId, tenantId)));
    }
  } else {
    await tx.insert(roleAssignments).values({ tenantId, roleId: toRoleId, userId, status: "active", createdBy: actorId, updatedBy: actorId });
  }
  await tx.insert(roleAssignmentHistory).values({ tenantId, roleId: toRoleId, userId, action: "assign", actorId, reason });
}
