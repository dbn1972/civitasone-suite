import { eq, desc, and, or } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { daks, notings, approvals, type DakRow, type DakInsert, type DakView, type NotingRow } from "./schema.js";
import type { Db } from "../../shared/db.js";

export function toView(r: DakRow): DakView {
  return {
    id: r.id, tenantId: r.tenantId, fileId: r.fileId, subject: r.subject, body: r.body,
    priority: r.priority, status: r.status, assignedTo: r.assignedTo, dueDate: r.dueDate,
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

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DakView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(daks).where(eq(daks.tenantId, tenantId)).orderBy(desc(daks.updatedAt)).limit(limit).offset(offset)
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

export async function forwardDak(tx: Writer, tenantId: string, id: string, assignedTo: string, forwardedBy: string): Promise<void> {
  await tx.update(daks)
    .set({ assignedTo, forwardedBy, forwardedAt: new Date(), status: "forwarded", updatedBy: forwardedBy, updatedAt: new Date() })
    // @ts-ignore drizzle where overload
    .where(and(eq(daks.tenantId, tenantId), eq(daks.id, id)));
}

export async function acknowledgeDak(tx: Writer, tenantId: string, id: string, actorId: string): Promise<void> {
  await tx.update(daks)
    .set({ acknowledgedAt: new Date(), status: "acknowledged", updatedBy: actorId, updatedAt: new Date() })
    // @ts-ignore drizzle where overload
    .where(and(eq(daks.tenantId, tenantId), eq(daks.id, id)));
}

export async function insertNoting(tx: Writer, row: typeof notings.$inferInsert): Promise<void> {
  await tx.insert(notings).values(row);
}

export async function insertApproval(tx: Writer, row: typeof approvals.$inferInsert): Promise<void> {
  await tx.insert(approvals).values(row);
}

export async function decideApproval(tx: Writer, tenantId: string, id: string, decision: string, remarks: string | null, decidedBy: string): Promise<void> {
  await tx.update(approvals)
    .set({ decision, remarks, decidedBy, decidedAt: new Date(), status: decision })
    // @ts-ignore drizzle where overload
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.id, id)));
}
