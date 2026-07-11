import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { causeLists, causeListItems } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type CauseListRow        = typeof causeLists.$inferSelect;
export type CauseListInsert     = typeof causeLists.$inferInsert;
export type CauseListItemRow    = typeof causeListItems.$inferSelect;
export type CauseListItemInsert = typeof causeListItems.$inferInsert;

/**
 * Postgres surfaces a double-booking as either a plain unique violation (23505)
 * or an exclusion-constraint violation (23P01) from the btree_gist EXCLUDE that
 * guards (tenant_id, list_date, slot, courtroom). Either maps to a NonRetryableError.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23505" || code === "23P01";
}

export async function insertCauseList(tx: Writer, row: CauseListInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(causeLists).values(row).onConflictDoNothing({ target: causeLists.id });
}

export async function getCauseList(
  tenantId: string, id: string,
): Promise<{ id: string; listDate: string; courtId: string } | undefined> {
  const rows = await db.select({ id: causeLists.id, listDate: causeLists.listDate, courtId: causeLists.courtId })
    .from(causeLists)
    .where(and(eq(causeLists.tenantId, tenantId), eq(causeLists.id, id)))
    .limit(1);
  return rows[0];
}

export async function insertCauseListItem(tx: Writer, row: CauseListItemInsert): Promise<void> {
  // NO onConflict: we WANT the btree_gist EXCLUDE to throw on a double-booking.
  await tx.insert(causeListItems).values(row);
}

export async function listItems(tenantId: string, causeListId: string): Promise<CauseListItemRow[]> {
  return db.select().from(causeListItems)
    .where(and(eq(causeListItems.tenantId, tenantId), eq(causeListItems.causeListId, causeListId)))
    .orderBy(asc(causeListItems.itemNumber));
}
