import { eq, ne, desc, and, or, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { daks, notings, approvals, type DakRow, type DakInsert, type DakView, type NotingRow, type ApprovalRow } from "./schema.js";
import type { Db } from "../../shared/db.js";

export function toView(r: DakRow): DakView {
  return {
    id: r.id, tenantId: r.tenantId, fileId: r.fileId, subject: r.subject, body: r.body,
    priority: r.priority, status: r.status, assignedTo: r.assignedTo, createdBy: r.createdBy, dueDate: r.dueDate,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listInbox(tenantId: string, userId: string, limit: number, offset: number): Promise<DakView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(daks)
      .where(and(eq(daks.tenantId, tenantId), eq(daks.assignedTo, userId as unknown as string & string)))
      .orderBy(desc(daks.updatedAt))
      .limit(limit).offset(offset)
  );
  return rows.map(toView);
}

/** `actorId` set => only daks the actor created or is assigned (non-admin callers); omitted => tenant-wide (admin roles). */
export async function listByTenant(tenantId: string, limit: number, offset: number, actorId?: string): Promise<DakView[]> {
  const where = actorId
    ? and(eq(daks.tenantId, tenantId), or(eq(daks.createdBy, actorId), eq(daks.assignedTo, actorId)))
    : eq(daks.tenantId, tenantId);
  const rows = await scopedRead((tx) =>
    tx.select().from(daks).where(where).orderBy(desc(daks.updatedAt)).limit(limit).offset(offset)
  );
  return rows.map(toView);
}

export async function getById(tenantId: string, id: string): Promise<DakView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(daks).where(and(eq(daks.tenantId, tenantId), eq(daks.id, id))).limit(1)
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function listNotings(tenantId: string, dakId: string): Promise<NotingRow[]> {
  return scopedRead((tx) =>
    tx.select().from(notings).where(and(eq(notings.tenantId, tenantId), eq(notings.dakId, dakId))).orderBy(notings.createdAt)
  );
}

export type Writer = Pick<Db, "insert" | "update">;

export async function insertDak(tx: Writer, row: DakInsert): Promise<void> {
  await tx.insert(daks).values(row);
}

/** Holder predicate: the current assignee, or the creator while the dak is unassigned (mirrors the route-level check). */
const heldBy = (actorId: string) => sql`coalesce(${daks.assignedTo}, ${daks.createdBy}) = ${actorId}`;

/**
 * Conditional on the CURRENT holder (unless `asAdmin`), so a reassignment between the route check and the
 * consume cannot let a stale holder act. Returns false (no row changed) when the guard rejects the command.
 */
export async function forwardDak(tx: Writer, tenantId: string, id: string, assignedTo: string, forwardedBy: string, asAdmin = false): Promise<boolean> {
  const rows = await tx.update(daks)
    .set({ assignedTo, forwardedBy, forwardedAt: new Date(), status: "forwarded", updatedBy: forwardedBy, updatedAt: new Date() })
    .where(and(eq(daks.tenantId, tenantId), eq(daks.id, id), asAdmin ? undefined : heldBy(forwardedBy)))
    .returning({ id: daks.id });
  return rows.length > 0;
}

export async function acknowledgeDak(tx: Writer, tenantId: string, id: string, actorId: string, asAdmin = false): Promise<boolean> {
  const rows = await tx.update(daks)
    .set({ acknowledgedAt: new Date(), status: "acknowledged", updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(daks.tenantId, tenantId), eq(daks.id, id), asAdmin ? undefined : heldBy(actorId)))
    .returning({ id: daks.id });
  return rows.length > 0;
}

export async function insertNoting(tx: Writer, row: typeof notings.$inferInsert): Promise<void> {
  await tx.insert(notings).values(row);
}

export async function insertApproval(tx: Writer, row: typeof approvals.$inferInsert): Promise<void> {
  await tx.insert(approvals).values(row);
}

export async function getApprovalById(tenantId: string, id: string): Promise<ApprovalRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(approvals).where(and(eq(approvals.tenantId, tenantId), eq(approvals.id, id))).limit(1)
  );
  return rows[0] ?? null;
}

/**
 * Decide a still-pending approval. Guarded in the statement itself: the decider must not be the submitter
 * (segregation of duties) and, unless `asAdmin`, must currently hold the underlying dak. Returns false when
 * the guard rejects it (already decided, self-approval, or not the approver).
 */
export async function decideApproval(tx: Writer, tenantId: string, id: string, decision: string, remarks: string | null, decidedBy: string, asAdmin = false): Promise<boolean> {
  const holder = sql`exists (select 1 from ${daks} where ${daks.tenantId} = ${approvals.tenantId} and ${daks.id} = ${approvals.dakId} and coalesce(${daks.assignedTo}, ${daks.createdBy}) = ${decidedBy})`;
  const rows = await tx.update(approvals)
    .set({ decision, remarks, decidedBy, decidedAt: new Date(), status: decision })
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.id, id), eq(approvals.status, "pending"), ne(approvals.createdBy, decidedBy), asAdmin ? undefined : holder))
    .returning({ id: approvals.id });
  return rows.length > 0;
}
