/**
 * consumables read queries — tenant-scoped via db.transaction() for RLS.
 */
import { eq, and, ilike, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { consumableItems } from "./schema.js";
import type { ConsumableItemRow } from "./schema.js";

export interface ListOpts {
  category?: string | undefined;
  search?: string | undefined;
  limit: number;
  offset: number;
}

export async function listConsumables(tenantId: string, opts: ListOpts): Promise<ConsumableItemRow[]> {
  const conds: SQL[] = [eq(consumableItems.tenantId, tenantId)];
  if (opts.category) conds.push(eq(consumableItems.category, opts.category));
  if (opts.search) conds.push(ilike(consumableItems.name, `%${opts.search}%`));
  return db.transaction((tx) =>
    tx.select().from(consumableItems)
      .where(and(...conds))
      .limit(opts.limit)
      .offset(opts.offset),
  );
}

export async function getConsumableById(tenantId: string, id: string): Promise<ConsumableItemRow | undefined> {
  const rows = await db.transaction((tx) =>
    tx.select().from(consumableItems)
      .where(and(eq(consumableItems.tenantId, tenantId), eq(consumableItems.id, id)))
      .limit(1),
  );
  return rows[0];
}
