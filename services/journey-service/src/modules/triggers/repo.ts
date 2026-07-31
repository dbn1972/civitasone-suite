/**
 * triggers/repo.ts — Database operations for journey trigger definitions.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { triggers, type TriggerRow, type TriggerInsert } from "./schema.js";

export function toView(r: TriggerRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    journeyId: r.journeyId,
    triggerType: r.triggerType,
    config: r.config,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}

export type TriggerView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<TriggerRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(triggers).where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  journeyId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: TriggerRow[]; total: number }> {
  const conditions: SQL[] = [eq(triggers.tenantId, tenantId)];

  if (filters.journeyId) {
    conditions.push(eq(triggers.journeyId, filters.journeyId));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(triggers).where(where).orderBy(desc(triggers.createdAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(triggers).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: TriggerInsert): Promise<void> {
  await tx.insert(triggers).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<TriggerInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(triggers)
    .set({ ...patch, updatedAt: new Date(), version: sql`${triggers.version} + 1` })
    .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId), eq(triggers.version, currentVersion)))
    .returning({ id: triggers.id });
  return result.length > 0;
}

export async function softDelete(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(triggers)
    .set({ status: "inactive", updatedAt: new Date(), version: sql`${triggers.version} + 1` })
    .where(and(eq(triggers.id, id), eq(triggers.tenantId, tenantId), eq(triggers.version, currentVersion)))
    .returning({ id: triggers.id });
  return result.length > 0;
}
