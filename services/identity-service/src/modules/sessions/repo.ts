import { eq, and, lte, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { sessions, type SessionRow, type SessionInsert } from "./schema.js";
import type { SessionView } from "./domain.js";

function toView(r: SessionRow): SessionView {
  // P1-2: an "active" row whose expiry has passed is presented as "expired"
  // even before the reaper sweep flips it, so reads never surface a stale
  // active session.
  const rawStatus = r.status as SessionView["status"];
  const status: SessionView["status"] =
    rawStatus === "active" && r.expiresAt.getTime() <= Date.now() ? "expired" : rawStatus;
  return {
    id: r.id, tenantId: r.tenantId, userId: r.userId, ip: r.ip,
    device: r.device ?? null, mfaMethod: r.mfaMethod ?? null, trusted: r.trusted,
    status,
    userEmail: r.userEmail,
    userName: r.userName ?? null,
    userAgent: r.userAgent ?? null,
    lastActiveAt: r.lastActiveAt.toISOString(),
    startedAt: r.startedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    version: r.version,
  };
}

export async function findById(tenantId: string, id: string): Promise<SessionView | null> {
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: SessionInsert): Promise<void> {
  await tx.insert(sessions).values(row);
}

export async function update(tx: Writer, tenantId: string, id: string, patch: Partial<SessionInsert>): Promise<void> {
  await tx.update(sessions).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)));
}

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<SessionView | null> {
  const rows = await tx.select().from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<SessionView[]> {
  const rows = await db.select().from(sessions)
    .where(eq(sessions.tenantId, tenantId))
    .limit(limit)
    .orderBy(sessions.startedAt);
  return rows.map(toView);
}


// P1-2: expired-session reaper. Flip any still-"active" row whose expiry has
// passed to "expired". Tenant-agnostic by design (a global housekeeping sweep
// run by the worker). Returns the number of rows transitioned.
export async function reapExpiredSessions(): Promise<number> {
  const rows = await db.update(sessions)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(sessions.status, "active"), lte(sessions.expiresAt, sql`now()`)))
    .returning({ id: sessions.id });
  return rows.length;
}
