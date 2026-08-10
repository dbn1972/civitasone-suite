import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageBills, type BillRow, type BillInsert } from "./schema.js";

export function toView(r: BillRow) {
  return {
    id: r.id, tenantId: r.tenantId, connectionId: r.connectionId, billNumber: r.billNumber,
    billingPeriod: r.billingPeriod, amountMinor: r.amountMinor, dueDate: r.dueDate,
    status: r.status, paymentRef: r.paymentRef,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<BillRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageBills).where(and(eq(sewerageBills.id, id), eq(sewerageBills.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, connectionId?: string) {
  const conditions = [eq(sewerageBills.tenantId, tenantId)];
  if (connectionId) conditions.push(eq(sewerageBills.connectionId, connectionId));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageBills).where(where).orderBy(desc(sewerageBills.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(sewerageBills).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: BillInsert): Promise<void> {
  await tx.insert(sewerageBills).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<BillInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(sewerageBills)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sewerageBills.version} + 1` })
    .where(and(eq(sewerageBills.id, id), eq(sewerageBills.tenantId, tenantId), eq(sewerageBills.version, currentVersion)))
    .returning({ id: sewerageBills.id });
  return result.length > 0;
}
