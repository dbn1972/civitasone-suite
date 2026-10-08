import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  tradeApplications, tradeApplicationEvents,
  type TradeApplicationRow, type TradeApplicationInsert,
  type TradeApplicationEventRow, type TradeApplicationEventInsert,
} from "./schema.js";

/**
 * GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-02: append a timeline event in
 * the SAME tx as the status transition that produced it.
 */
export async function insertEvent(tx: ScopedTx, row: TradeApplicationEventInsert): Promise<void> {
  await tx.insert(tradeApplicationEvents).values(row);
}

/** List an application's timeline (oldest → newest) for the officer History card. */
export async function listHistory(applicationId: string, tenantId: string): Promise<TradeApplicationEventRow[]> {
  return scopedRead((tx) =>
    tx.select().from(tradeApplicationEvents)
      .where(and(eq(tradeApplicationEvents.applicationId, applicationId), eq(tradeApplicationEvents.tenantId, tenantId)))
      .orderBy(tradeApplicationEvents.createdAt),
  );
}

export async function findById(id: string, tenantId: string): Promise<TradeApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeApplications)
      .where(and(eq(tradeApplications.id, id), eq(tradeApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(applicationNumber: string, tenantId: string): Promise<TradeApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeApplications)
      .where(and(eq(tradeApplications.applicationNumber, applicationNumber), eq(tradeApplications.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: TradeApplicationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(tradeApplications.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(tradeApplications.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(tradeApplications)
      .where(and(...conditions))
      .orderBy(desc(tradeApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(tradeApplications)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertApplication(tx: ScopedTx, row: TradeApplicationInsert): Promise<void> {
  await tx.insert(tradeApplications).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(tradeApplications)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(status === "submitted" ? { submittedAt: new Date() } : {}),
      version: sql`${tradeApplications.version} + 1`,
    })
    .where(and(eq(tradeApplications.id, id), eq(tradeApplications.tenantId, tenantId)))
    .returning({ id: tradeApplications.id });
  return result.length > 0;
}

export async function updateFeePayment(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  transactionId: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(tradeApplications)
    .set({
      feePaid: true,
      feeTransactionId: transactionId,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${tradeApplications.version} + 1`,
    })
    .where(and(eq(tradeApplications.id, id), eq(tradeApplications.tenantId, tenantId)))
    .returning({ id: tradeApplications.id });
  return result.length > 0;
}
