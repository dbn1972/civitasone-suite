/**
 * matching module — read-model (query) handlers.
 * All reads go through Redis cache (read-through pattern).
 */
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { threeWayMatches } from "./schema.js";
import { eq, and, SQL, sql } from "drizzle-orm";
import { SERVICE, RESOURCE } from "../../topics.js";

interface MatchQuery {
  poId?: string | undefined;
  grnId?: string | undefined;
  invoiceId?: string | undefined;
  status?: string | undefined;
  limit: number;
  offset: number;
}

export async function getMatch(tenantId: string, id: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:${RESOURCE.threeWayMatch}:${id}`, async () => {
    const rows = await db.select().from(threeWayMatches)
      .where(and(eq(threeWayMatches.tenantId, tenantId), eq(threeWayMatches.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function listMatches(tenantId: string, query: MatchQuery) {
  const conditions: SQL[] = [eq(threeWayMatches.tenantId, tenantId)];

  if (query.poId) conditions.push(eq(threeWayMatches.poId, query.poId));
  if (query.grnId) conditions.push(eq(threeWayMatches.grnId, query.grnId));
  if (query.invoiceId) conditions.push(eq(threeWayMatches.invoiceId, query.invoiceId));
  if (query.status) conditions.push(eq(threeWayMatches.status, query.status));

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db.select().from(threeWayMatches).where(where).limit(query.limit).offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(threeWayMatches).where(where),
  ]);

  const total = countResult[0]?.count ?? 0;
  return {
    data: rows,
    meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
  };
}
