/**
 * journeys/repo.ts — Database operations for journey definitions.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { journeys, type JourneyRow, type JourneyInsert } from "./schema.js";

export function toView(r: JourneyRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    status: r.status,
    triggerConfig: r.triggerConfig,
    steps: r.steps,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}

export type JourneyView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<JourneyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(journeys).where(and(eq(journeys.id, id), eq(journeys.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: JourneyRow[]; total: number }> {
  const conditions: SQL[] = [eq(journeys.tenantId, tenantId)];

  if (filters.status) {
    conditions.push(eq(journeys.status, filters.status));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(journeys).where(where).orderBy(desc(journeys.updatedAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(journeys).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: JourneyInsert): Promise<void> {
  await tx.insert(journeys).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<JourneyInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(journeys)
    .set({ ...patch, updatedAt: new Date(), version: sql`${journeys.version} + 1` })
    .where(and(eq(journeys.id, id), eq(journeys.tenantId, tenantId), eq(journeys.version, currentVersion)))
    .returning({ id: journeys.id });
  return result.length > 0;
}

export async function softDelete(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(journeys)
    .set({ status: "archived", updatedAt: new Date(), version: sql`${journeys.version} + 1` })
    .where(and(eq(journeys.id, id), eq(journeys.tenantId, tenantId), eq(journeys.version, currentVersion)))
    .returning({ id: journeys.id });
  return result.length > 0;
}
