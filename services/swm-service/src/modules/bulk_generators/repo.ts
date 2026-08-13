import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { swmBulkGenerators, type BulkGeneratorRow, type BulkGeneratorInsert } from "./schema.js";

export function toView(r: BulkGeneratorRow) {
  return {
    id: r.id, tenantId: r.tenantId, registrationNumber: r.registrationNumber,
    generatorName: r.generatorName, generatorType: r.generatorType,
    address: r.address, estimatedWasteKgPerDay: r.estimatedWasteKgPerDay,
    category: r.category, status: r.status, feeMinor: r.feeMinor,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<BulkGeneratorRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(swmBulkGenerators).where(and(eq(swmBulkGenerators.id, id), eq(swmBulkGenerators.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(swmBulkGenerators.tenantId, tenantId)];
  if (status) conditions.push(eq(swmBulkGenerators.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(swmBulkGenerators).where(where).orderBy(desc(swmBulkGenerators.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(swmBulkGenerators).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: BulkGeneratorInsert): Promise<void> {
  await tx.insert(swmBulkGenerators).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<BulkGeneratorInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(swmBulkGenerators)
    .set({ ...patch, updatedAt: new Date(), version: sql`${swmBulkGenerators.version} + 1` })
    .where(and(eq(swmBulkGenerators.id, id), eq(swmBulkGenerators.tenantId, tenantId), eq(swmBulkGenerators.version, currentVersion)))
    .returning({ id: swmBulkGenerators.id });
  return result.length > 0;
}
