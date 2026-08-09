import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventPermits, type EventPermitRow, type EventPermitInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<EventPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventPermits)
      .where(and(eq(eventPermits.id, id), eq(eventPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByApplication(applicationId: string, tenantId: string): Promise<EventPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventPermits)
      .where(and(eq(eventPermits.applicationId, applicationId), eq(eventPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: EventPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(eventPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(eventPermits.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(eventPermits)
      .where(and(...conditions))
      .orderBy(desc(eventPermits.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(eventPermits)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: EventPermitInsert): Promise<void> {
  await tx.insert(eventPermits).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(eventPermits)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${eventPermits.version} + 1`,
    })
    .where(and(eq(eventPermits.id, id), eq(eventPermits.tenantId, tenantId)))
    .returning({ id: eventPermits.id });
  return result.length > 0;
}
