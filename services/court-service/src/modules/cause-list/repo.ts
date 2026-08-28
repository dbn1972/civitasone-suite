import { eq, and, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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

/**
 * Postgres surfaces a reference to a case that doesn't exist (e.g. a rare
 * TOCTOU race with the command layer's synchronous existence pre-check) as a
 * foreign-key violation (23503) on `cause_list_items_case_id_fkey`. Maps to a
 * NonRetryableError so it dead-letters instead of retrying forever — a
 * backstop behind the pre-check, not the primary defense.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23503";
}

export async function insertCauseList(tx: Writer, row: CauseListInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(causeLists).values(row).onConflictDoNothing({ target: causeLists.id });
}

export async function getCauseList(
  tenantId: string, id: string,
): Promise<{ id: string; listDate: string; courtId: string } | undefined> {
  const rows = await scopedRead<{ id: string; listDate: string; courtId: string }[]>((tx) => tx.select({ id: causeLists.id, listDate: causeLists.listDate, courtId: causeLists.courtId })
    .from(causeLists)
    .where(and(eq(causeLists.tenantId, tenantId), eq(causeLists.id, id)))
    .limit(1));
  return rows[0];
}

/**
 * Look up a single cause-list item by its deterministic id (tenant-scoped). Used
 * by the command layer to detect a resubmission of the same (list, case) pair
 * BEFORE publishing, so a genuine edit attempt (different slot/courtroom/item
 * number) can be rejected honestly instead of silently no-op'ing (§17 gap).
 */
export async function getItemById(
  tenantId: string, id: string,
): Promise<{ id: string; slot: string | null; courtroom: string | null; itemNumber: number | null } | undefined> {
  const rows = await scopedRead<{ id: string; slot: string | null; courtroom: string | null; itemNumber: number | null }[]>((tx) => tx.select({
    id: causeListItems.id,
    slot: causeListItems.slot,
    courtroom: causeListItems.courtroom,
    itemNumber: causeListItems.itemNumber,
  })
    .from(causeListItems)
    .where(and(eq(causeListItems.tenantId, tenantId), eq(causeListItems.id, id)))
    .limit(1));
  return rows[0];
}

/**
 * Find an existing item already occupying (tenantId, listDate, slot,
 * courtroom) — matches the scope of the DB's `cause_list_items_no_double_booking`
 * btree_gist EXCLUDE constraint (see migrations/0001_court_core.sql) EXACTLY,
 * including that it has NO case_id dimension: a physical courtroom+slot can
 * only be booked once on a given date, full stop — even by the SAME case via
 * a different cause-list. (An earlier version of this function excluded the
 * submitting case, which was wrong: it let that exact scenario silently pass
 * the pre-check and fail asynchronously instead, the same bug class this is
 * meant to prevent.) Only call this once the command layer has confirmed no
 * existing (causeListId, caseId) item already exists for this submission, so
 * any row found here is a genuine new conflict, never the row about to be
 * inserted. Remains the authoritative backstop for the rare concurrent-race
 * case this pre-check can't see.
 */
export async function findSlotConflict(
  tenantId: string, listDate: string, slot: string, courtroom: string,
): Promise<{ id: string; caseId: string } | undefined> {
  const rows = await scopedRead<{ id: string; caseId: string }[]>((tx) => tx.select({
    id: causeListItems.id,
    caseId: causeListItems.caseId,
  })
    .from(causeListItems)
    .where(and(
      eq(causeListItems.tenantId, tenantId),
      eq(causeListItems.listDate, listDate),
      eq(causeListItems.slot, slot),
      eq(causeListItems.courtroom, courtroom),
    ))
    .limit(1));
  return rows[0];
}

export async function insertCauseListItem(tx: Writer, row: CauseListItemInsert): Promise<void> {
  // NO onConflict: we WANT the btree_gist EXCLUDE to throw on a double-booking.
  await tx.insert(causeListItems).values(row);
}

export async function listItems(tenantId: string, causeListId: string): Promise<CauseListItemRow[]> {
  return scopedRead((tx) => tx.select().from(causeListItems)
    .where(and(eq(causeListItems.tenantId, tenantId), eq(causeListItems.causeListId, causeListId)))
    .orderBy(asc(causeListItems.itemNumber)));
}
