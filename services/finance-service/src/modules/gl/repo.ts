import { eq, and, ne, gte, lte, sql, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financeJournals, financeLedger, financeJournalLines, type JournalRow, type JournalInsert, type LedgerInsert, type JournalLineInsert } from "./schema.js";
import { financeHeads } from "../budget/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertJournal(tx: Writer, row: JournalInsert): Promise<void> {
  await tx.insert(financeJournals).values(row);
}

export async function insertLedgerLine(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(financeLedger).values(row);
}

export async function insertJournalLine(tx: Writer, row: JournalLineInsert): Promise<void> {
  await tx.insert(financeJournalLines).values(row);
}

export async function findJournalById(id: string): Promise<JournalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)).limit(1));
  return rows[0] ?? null;
}

/** Idempotency check inside a tx: has this journal id already been posted? */
export async function findJournalByIdTx(tx: Writer, id: string): Promise<JournalRow | null> {
  const rows = await (tx as typeof db).select().from(financeJournals).where(eq(financeJournals.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Mark a journal reversed and link the reversing journal (controlled status transition). */
export async function markJournalReversed(tx: Writer, id: string, reversedByUpdatedBy: string): Promise<void> {
  await tx.update(financeJournals)
    .set({ status: "reversed", updatedBy: reversedByUpdatedBy, updatedAt: new Date() })
    .where(eq(financeJournals.id, id));
}

/**
 * DOM-024 — finalize a manual maker-checker draft: pending_approval -> posted,
 * in place (UPDATE, not a second insert — the row already exists from the
 * finance.gl.create step). created_by (the maker) is left untouched here and
 * is additionally enforced immutable by the gl.block_journal_mutation trigger
 * (migration 0014 + 0073); only status/voucher_no/updated_by/updated_at
 * change. voucher_no moves from its AUTO placeholder to the real
 * gapless-allocated number — the trigger permits voucher_no to change ONLY
 * on this exact status edge.
 */
export async function markPendingJournalPosted(tx: Writer, id: string, fields: { voucherNo: string; updatedBy: string }): Promise<void> {
  await tx.update(financeJournals)
    .set({ status: "posted", voucherNo: fields.voucherNo, updatedBy: fields.updatedBy, updatedAt: new Date() })
    .where(eq(financeJournals.id, id));
}

/** Resolve a headId that may be a UUID or a 4-digit account code. Returns the UUID or null. */
export async function resolveHeadId(tenantId: string, headIdOrCode: string): Promise<string | null> {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headIdOrCode);
  if (isUUID) return headIdOrCode;
  const rows = await scopedRead((tx) => tx.select({ id: financeHeads.id })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), eq(financeHeads.code, headIdOrCode)))
    .limit(1));
  return rows[0]?.id ?? null;
}

export async function getLedgerLines(tenantId: string, headId: string | undefined, from?: string, to?: string, limit = 50) {
  const conditions: ReturnType<typeof eq>[] = [eq(financeLedger.tenantId, tenantId)];
  if (headId) conditions.push(eq(financeLedger.headId, headId));
  if (from) conditions.push(gte(financeLedger.postingDate, from));
  if (to)   conditions.push(lte(financeLedger.postingDate, to));
  return scopedRead((tx) => tx.select().from(financeLedger).where(and(...conditions)).orderBy(asc(financeLedger.postingDate)).limit(limit));
}

export async function getTrialBalance(tenantId: string) {
  return scopedRead((tx) => tx
    .select({
      headId:      financeLedger.headId,
      totalDebit:  sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit: sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .where(eq(financeLedger.tenantId, tenantId))
    .groupBy(financeLedger.headId));
}

/**
 * BUG FIX (accounting-critical #2): Financial Statements need each head's
 * REAL chart-of-accounts classification (budget.finance_heads.code /
 * .classification) to derive Asset/Liability/Income/Expenditure — the
 * previous code in gl/queries.ts derived it from array-index parity instead,
 * so it was wrong for every account. A dedicated query (rather than widening
 * getTrialBalance above, which other callers depend on for its current
 * shape) LEFT JOINs finance_heads onto the same per-head ledger aggregate so
 * listFinancialStatements can classify correctly. LEFT JOIN (not INNER):
 * a ledger row must never disappear from the statement just because its head
 * lookup fails; deriveStatementType in queries.ts falls back sensibly when
 * code/classification come back null.
 */
export async function getTrialBalanceWithClassification(tenantId: string) {
  return scopedRead((tx) => tx
    .select({
      headId:         financeLedger.headId,
      code:           financeHeads.code,
      classification: financeHeads.classification,
      totalDebit:     sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit:    sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .leftJoin(financeHeads, and(
      eq(financeLedger.headId, financeHeads.id),
      eq(financeHeads.tenantId, tenantId),
    ))
    .where(eq(financeLedger.tenantId, tenantId))
    .groupBy(financeLedger.headId, financeHeads.code, financeHeads.classification));
}

/**
 * DOM-024: excludes pending_approval drafts — a manual journal awaiting a
 * checker's approval has not really happened yet (no ledger lines, no
 * budget/period effect) and must not appear in the GL entries list
 * alongside real postings. Reversed journals stay visible (they WERE
 * posted); a future non-"posted"/"reversed" status is excluded by default
 * rather than requiring this allow-list to be extended for it.
 */
export async function listJournalsByTenant(tenantId: string, limit: number, offset = 0): Promise<JournalRow[]> {
  return scopedRead((tx) => tx.select().from(financeJournals)
    .where(and(eq(financeJournals.tenantId, tenantId), ne(financeJournals.status, "pending_approval")))
    .orderBy(financeJournals.postingDate)
    .limit(limit)
    .offset(offset));
}

/**
 * Trial balance summed per period (YYYY-MM from posting_date), with the
 * balanced check: sum(debit) must equal sum(credit) for every period.
 */
export async function getTrialBalanceByPeriod(tenantId: string, period?: string) {
  const conditions = [eq(financeLedger.tenantId, tenantId)];
  if (period) conditions.push(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM') = ${period}`);
  return scopedRead((tx) => tx
    .select({
      period:      sql<string>`to_char(${financeLedger.postingDate}, 'YYYY-MM')`,
      totalDebit:  sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit: sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .where(and(...conditions))
    .groupBy(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM')`));
}
