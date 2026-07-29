import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsSelectionLists, hrmsSelectionListEntries,
  type SelectionListRow, type SelectionListInsert, type SelectionEntryRow, type SelectionEntryInsert,
} from "./selection-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

/** Rows affected — postgres-js exposes .count, not .rowCount (PR #254). */
function affectedRows(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function insertList(tx: Writer, row: SelectionListInsert): Promise<void> {
  await tx.insert(hrmsSelectionLists).values(row);
}
export async function findList(tenantId: string, id: string): Promise<SelectionListRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsSelectionLists)
    .where(and(eq(hrmsSelectionLists.tenantId, tenantId), eq(hrmsSelectionLists.id, id))).limit(1));
  return rows[0] ?? null;
}
export async function updateList(tx: Writer, tenantId: string, id: string, patch: Partial<SelectionListInsert>, expectedVersion: number): Promise<void> {
  const res = await tx.update(hrmsSelectionLists)
    .set({ ...patch, version: sql`${hrmsSelectionLists.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsSelectionLists.tenantId, tenantId), eq(hrmsSelectionLists.id, id), eq(hrmsSelectionLists.version, expectedVersion)));
  if (affectedRows(res) === 0) throw new HttpError(409, "VERSION_CONFLICT", "selection list was modified by another request; reload and retry");
}
export async function listByJob(tenantId: string, jobOpeningId: string): Promise<SelectionListRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsSelectionLists)
    .where(and(eq(hrmsSelectionLists.tenantId, tenantId), eq(hrmsSelectionLists.jobOpeningId, jobOpeningId)))
    .orderBy(desc(hrmsSelectionLists.createdAt)));
}

/** Full replacement of a list's entries (delete then insert) + version bump, in one txn. */
export async function setEntries(tx: Writer, tenantId: string, listId: string, rows: SelectionEntryInsert[]): Promise<void> {
  await tx.delete(hrmsSelectionListEntries)
    .where(and(eq(hrmsSelectionListEntries.tenantId, tenantId), eq(hrmsSelectionListEntries.listId, listId)));
  if (rows.length > 0) await tx.insert(hrmsSelectionListEntries).values(rows);
}
export async function listEntries(tenantId: string, listId: string): Promise<SelectionEntryRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsSelectionListEntries)
    .where(and(eq(hrmsSelectionListEntries.tenantId, tenantId), eq(hrmsSelectionListEntries.listId, listId))));
}
