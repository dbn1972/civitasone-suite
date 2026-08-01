/**
 * events/taxonomy-repo.ts — CDP-004 database operations for the event taxonomy registry.
 */
import { eq, and, sql, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventTaxonomy, type EventTaxonomyRow, type EventTaxonomyInsert } from "./schema.js";

export function toView(r: EventTaxonomyRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    eventName: r.eventName,
    category: r.category,
    schemaJson: r.schemaJson,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type TaxonomyView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<EventTaxonomyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventTaxonomy)
      .where(and(eq(eventTaxonomy.id, id), eq(eventTaxonomy.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByEventName(eventName: string, tenantId: string): Promise<EventTaxonomyRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventTaxonomy)
      .where(and(eq(eventTaxonomy.eventName, eventName), eq(eventTaxonomy.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { status?: string; category?: string } = {},
): Promise<{ rows: EventTaxonomyRow[]; total: number }> {
  const conditions: SQL[] = [eq(eventTaxonomy.tenantId, tenantId)];
  if (filters.status !== undefined) conditions.push(eq(eventTaxonomy.status, filters.status));
  if (filters.category !== undefined) conditions.push(eq(eventTaxonomy.category, filters.category));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(eventTaxonomy)
      .where(where)
      .orderBy(asc(eventTaxonomy.eventName))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(eventTaxonomy).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: EventTaxonomyInsert): Promise<void> {
  await tx.insert(eventTaxonomy).values(row);
}

/** Optimistic-locked update; false when someone else already moved the definition on. */
export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<EventTaxonomyInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(eventTaxonomy)
    .set({ ...patch, updatedAt: new Date(), version: sql`${eventTaxonomy.version} + 1` })
    .where(and(
      eq(eventTaxonomy.id, id),
      eq(eventTaxonomy.tenantId, tenantId),
      eq(eventTaxonomy.version, currentVersion),
    ))
    .returning({ id: eventTaxonomy.id });
  return result.length > 0;
}
