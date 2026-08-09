import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventApplications, type EventApplicationRow, type EventApplicationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<EventApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventApplications)
      .where(and(eq(eventApplications.id, id), eq(eventApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(applicationNumber: string, tenantId: string): Promise<EventApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventApplications)
      .where(and(eq(eventApplications.applicationNumber, applicationNumber), eq(eventApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: EventApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(eventApplications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(eventApplications.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(eventApplications)
      .where(and(...conditions))
      .orderBy(desc(eventApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(eventApplications)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: EventApplicationInsert): Promise<void> {
  await tx.insert(eventApplications).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(eventApplications)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      submittedAt: status === "submitted" ? new Date() : undefined,
      version: sql`${eventApplications.version} + 1`,
    })
    .where(and(eq(eventApplications.id, id), eq(eventApplications.tenantId, tenantId)))
    .returning({ id: eventApplications.id });
  return result.length > 0;
}
