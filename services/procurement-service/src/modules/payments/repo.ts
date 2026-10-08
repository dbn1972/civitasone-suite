import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementAdvances, procurementDebitNotes,
  type AdvanceInsert, type DebitNoteInsert,
  type AdvanceRow, type DebitNoteRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertAdvance(tx: Writer, row: AdvanceInsert): Promise<void> {
  await tx.insert(procurementAdvances).values(row);
}

export async function insertDebitNote(tx: Writer, row: DebitNoteInsert): Promise<void> {
  await tx.insert(procurementDebitNotes).values(row);
}

export async function listAdvancesByTenant(
  tenantId: string,
  opts: { poRef?: string; vendorId?: string; status?: string; limit: number; offset: number },
): Promise<AdvanceRow[]> {
  const conditions: ReturnType<typeof eq>[] = [eq(procurementAdvances.tenantId, tenantId)];
  if (opts.poRef) conditions.push(eq(procurementAdvances.poRef, opts.poRef));
  if (opts.vendorId) conditions.push(eq(procurementAdvances.vendorId, opts.vendorId));
  if (opts.status) conditions.push(eq(procurementAdvances.status, opts.status));
  return db.transaction((tx) =>
    (tx as typeof db).select().from(procurementAdvances).where(and(...conditions)).limit(opts.limit).offset(opts.offset),
  );
}

export async function listDebitNotesByTenant(
  tenantId: string,
  opts: { grnRef?: string; vendorId?: string; status?: string; limit: number; offset: number },
): Promise<DebitNoteRow[]> {
  const conditions: ReturnType<typeof eq>[] = [eq(procurementDebitNotes.tenantId, tenantId)];
  if (opts.grnRef) conditions.push(eq(procurementDebitNotes.grnRef, opts.grnRef));
  if (opts.vendorId) conditions.push(eq(procurementDebitNotes.vendorId, opts.vendorId));
  if (opts.status) conditions.push(eq(procurementDebitNotes.status, opts.status));
  return db.transaction((tx) =>
    (tx as typeof db).select().from(procurementDebitNotes).where(and(...conditions)).limit(opts.limit).offset(opts.offset),
  );
}

/**
 * GAP2-PROCUREMENT-GAPLIST-03: real COUNT(*) over advances + debit-notes with
 * the SAME filters as the list functions (no limit/offset). The /payments
 * endpoint concatenates both lists, so its true total is the sum of the two
 * counts.
 */
export async function countAdvancesByTenant(
  tenantId: string,
  opts: { poRef?: string; vendorId?: string; status?: string },
): Promise<number> {
  const conditions: ReturnType<typeof eq>[] = [eq(procurementAdvances.tenantId, tenantId)];
  if (opts.poRef) conditions.push(eq(procurementAdvances.poRef, opts.poRef));
  if (opts.vendorId) conditions.push(eq(procurementAdvances.vendorId, opts.vendorId));
  if (opts.status) conditions.push(eq(procurementAdvances.status, opts.status));
  const rows = await db.transaction((tx) =>
    (tx as typeof db).select({ n: sql<number>`COUNT(*)` }).from(procurementAdvances).where(and(...conditions)),
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countDebitNotesByTenant(
  tenantId: string,
  opts: { grnRef?: string; vendorId?: string; status?: string },
): Promise<number> {
  const conditions: ReturnType<typeof eq>[] = [eq(procurementDebitNotes.tenantId, tenantId)];
  if (opts.grnRef) conditions.push(eq(procurementDebitNotes.grnRef, opts.grnRef));
  if (opts.vendorId) conditions.push(eq(procurementDebitNotes.vendorId, opts.vendorId));
  if (opts.status) conditions.push(eq(procurementDebitNotes.status, opts.status));
  const rows = await db.transaction((tx) =>
    (tx as typeof db).select({ n: sql<number>`COUNT(*)` }).from(procurementDebitNotes).where(and(...conditions)),
  );
  return Number(rows[0]?.n ?? 0);
}

export async function findAdvanceById(id: string, tenantId: string): Promise<AdvanceRow | null> {
  const rows = await db.transaction((tx) =>
    (tx as typeof db).select().from(procurementAdvances)
      .where(and(eq(procurementAdvances.id, id), eq(procurementAdvances.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findDebitNoteById(id: string, tenantId: string): Promise<DebitNoteRow | null> {
  const rows = await db.transaction((tx) =>
    (tx as typeof db).select().from(procurementDebitNotes)
      .where(and(eq(procurementDebitNotes.id, id), eq(procurementDebitNotes.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}
