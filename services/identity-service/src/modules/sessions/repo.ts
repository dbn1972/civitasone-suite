import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { sessions, type SessionRow, type SessionInsert } from "./schema.js";
import type { SessionView } from "./domain.js";

function toView(r: SessionRow): SessionView {
  return {
    id: r.id, tenantId: r.tenantId, userId: r.userId, ip: r.ip,
    device: r.device ?? null, mfaMethod: r.mfaMethod ?? null, trusted: r.trusted,
    status: r.status as SessionView["status"],
    userEmail: r.userEmail,
    userName: r.userName ?? null,
    userAgent: r.userAgent ?? null,
    lastActiveAt: r.lastActiveAt.toISOString(),
    startedAt: r.startedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    version: r.version,
  };
}

export async function findById(id: string): Promise<SessionView | null> {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: SessionInsert): Promise<void> {
  await tx.insert(sessions).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SessionInsert>): Promise<void> {
  await tx.update(sessions).set({ ...patch, updatedAt: new Date() }).where(eq(sessions.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<SessionView | null> {
  const rows = await tx.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<SessionView[]> {
  const rows = await db.select().from(sessions)
    .where(eq(sessions.tenantId, tenantId))
    .limit(limit)
    .orderBy(sessions.startedAt);
  return rows.map(toView);
}
