/**
 * cycle-count module — read-model (query) handlers.
 * All reads go through Redis cache (read-through pattern).
 */
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { cycleCounts } from "./schema.js";
import { eq, and, SQL, sql } from "drizzle-orm";
import { SERVICE, RESOURCE } from "../../topics.js";

interface CycleCountQuery {
  itemId?: string | undefined;
  warehouseId?: string | undefined;
  status?: string | undefined;
  limit: number;
  offset: number;
}

export async function getCycleCount(tenantId: string, id: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:${RESOURCE.cycleCount}:${id}`, async () => {
    const rows = await db.select().from(cycleCounts)
      .where(and(eq(cycleCounts.tenantId, tenantId), eq(cycleCounts.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function listCycleCounts(tenantId: string, query: CycleCountQuery) {
  const conditions: SQL[] = [eq(cycleCounts.tenantId, tenantId)];

  if (query.itemId) conditions.push(eq(cycleCounts.itemId, query.itemId));
  if (query.warehouseId) conditions.push(eq(cycleCounts.warehouseId, query.warehouseId));
  if (query.status) conditions.push(eq(cycleCounts.status, query.status));

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db.select().from(cycleCounts).where(where).limit(query.limit).offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(cycleCounts).where(where),
  ]);

  const total = countResult[0]?.count ?? 0;
  return {
    data: rows,
    meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
  };
}
