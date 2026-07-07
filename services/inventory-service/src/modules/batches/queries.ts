/**
 * Query handlers (READ PATH) — read-through cache, always tenant-scoped.
 */
import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import { db } from "../../shared/db.js";
import { batches, serialNumbers, type BatchRow, type SerialNumberRow } from "./schema.js";

export async function getBatch(tenantId: string, id: string): Promise<BatchRow | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE.batch, id), async () => {
    const rows = await db.select().from(batches)
      .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function listBatches(
  tenantId: string,
  opts: { itemId?: string | undefined; status?: string | undefined; limit: number; offset: number },
): Promise<{ data: BatchRow[]; meta: { page: number; pageSize: number; total: number } }> {
  const conditions = [eq(batches.tenantId, tenantId)];
  if (opts.itemId) conditions.push(eq(batches.itemId, opts.itemId));
  if (opts.status) conditions.push(eq(batches.status, opts.status));

  const rows = await db.select().from(batches)
    .where(and(...conditions))
    .limit(opts.limit)
    .offset(opts.offset);

  return {
    data: rows,
    meta: {
      page: Math.floor(opts.offset / opts.limit) + 1,
      pageSize: opts.limit,
      total: rows.length,
    },
  };
}

export async function getSerial(tenantId: string, id: string): Promise<SerialNumberRow | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE.serial, id), async () => {
    const rows = await db.select().from(serialNumbers)
      .where(and(eq(serialNumbers.id, id), eq(serialNumbers.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function listSerials(
  tenantId: string,
  opts: { itemId?: string | undefined; batchId?: string | undefined; status?: string | undefined; limit: number; offset: number },
): Promise<{ data: SerialNumberRow[]; meta: { page: number; pageSize: number; total: number } }> {
  const conditions = [eq(serialNumbers.tenantId, tenantId)];
  if (opts.itemId) conditions.push(eq(serialNumbers.itemId, opts.itemId));
  if (opts.batchId) conditions.push(eq(serialNumbers.batchId, opts.batchId));
  if (opts.status) conditions.push(eq(serialNumbers.status, opts.status));

  const rows = await db.select().from(serialNumbers)
    .where(and(...conditions))
    .limit(opts.limit)
    .offset(opts.offset);

  return {
    data: rows,
    meta: {
      page: Math.floor(opts.offset / opts.limit) + 1,
      pageSize: opts.limit,
      total: rows.length,
    },
  };
}

/**
 * Check if a serial number already exists for a given item+tenant combination.
 * Used by the consumer to enforce uniqueness before insert.
 */
export async function serialExists(tenantId: string, itemId: string, serialNumber: string): Promise<boolean> {
  const rows = await db.select().from(serialNumbers)
    .where(and(
      eq(serialNumbers.tenantId, tenantId),
      eq(serialNumbers.itemId, itemId),
      eq(serialNumbers.serialNumber, serialNumber),
    ))
    .limit(1);
  return rows.length > 0;
}
