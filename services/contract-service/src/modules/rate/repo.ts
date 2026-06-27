import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { contractRateContracts, contractRateItems, type RcRow, type RcInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRcById(id: string, tenantId: string): Promise<RcRow | null> {
  const rows = await db.select().from(contractRateContracts)
    .where(and(eq(contractRateContracts.id, id), eq(contractRateContracts.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findRcsByItem(tenantId: string, itemCode: string): Promise<RcRow[]> {
  const items = await db.select().from(contractRateItems)
    .where(and(eq(contractRateItems.tenantId, tenantId), eq(contractRateItems.itemCode, itemCode)))
    .limit(100);
  if (!items.length) return [];
  const rcIds = [...new Set(items.map((i) => i.rcId))];
  const rcs: RcRow[] = [];
  for (const rcId of rcIds) {
    const rc = await findRcById(rcId, tenantId);
    if (rc) rcs.push(rc);
  }
  return rcs;
}

export async function insertRc(tx: Writer, row: RcInsert): Promise<void> {
  await tx.insert(contractRateContracts).values(row);
}

export async function insertRcItems(tx: Writer, items: (typeof contractRateItems.$inferInsert)[]): Promise<void> {
  if (items.length) await tx.insert(contractRateItems).values(items);
}
