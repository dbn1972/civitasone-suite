import { eq, and, ne, gte, lte, sql, asc, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
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
/**
 * GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05: the journal (any status, including a pending_approval draft, which holds its
 * typed number against UNIQUE(tenant_id, voucher_no)) already using this exact voucher number, or null.
 */
export async function findJournalByVoucherNo(tenantId: string, voucherNo: string): Promise<{ id: string } | null> {
  const rows = await scopedRead((tx) => tx.select({ id: financeJournals.id }).from(financeJournals)
    .where(and(eq(financeJournals.tenantId, tenantId), eq(financeJournals.voucherNo, voucherNo))).limit(1));
  return rows[0] ?? null;
}

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

export type JournalLinePageFilter = {
  tenantId: string;
  from?: string | undefined;   // inclusive ISO date
  to?: string | undefined;     // inclusive ISO date
  type?: string | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
};

export type JournalLineRow = {
  journal_id: string; voucher_no: string; type: string; posting_date: string;
  account_code: string; narration: string | null; debit: string; credit: string;
};

/**
 * GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: one bounded, server-filtered page of ledger LINES
 * (journals.lines jsonb unnested) plus totals over the WHOLE filtered set, so the page never needs
 * the full ledger in the browser. Same journal visibility as listJournalsByTenant (pending_approval
 * drafts excluded). Stable order: posting date, voucher no, journal id, line position.
 */
export async function pageJournalLines(f: JournalLinePageFilter) {
  // The scope every figure shares: this tenant's visible journals inside the requested fiscal year.
  const ledgerConds: SQL[] = [
    sql`j.tenant_id = ${f.tenantId}::uuid`,
    sql`j.status <> 'pending_approval'`,
  ];
  if (f.from) ledgerConds.push(sql`j.posting_date >= ${f.from}::date`);
  if (f.to) ledgerConds.push(sql`j.posting_date <= ${f.to}::date`);
  // The voucher-type tab and the search narrow it further. Only that narrowed set is paged and totalled as
  // `totals`; the fiscal-year ledger as a whole is totalled separately as `ledgerTotals`.
  const conds: SQL[] = [...ledgerConds];
  if (f.type) conds.push(sql`j.type = ${f.type}`);
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(sql`(j.voucher_no ILIKE ${like} OR coalesce(ln.elem->>'accountCode', ln.elem->>'account', '') ILIKE ${like} OR coalesce(ln.elem->>'narration', '') ILIKE ${like})`);
  }
  const narrowed = conds.length > ledgerConds.length;
  const baseOf = (cs: SQL[]) => sql`
    FROM gl.finance_journals j
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.lines) = 'array' THEN j.lines ELSE '[]'::jsonb END)
      WITH ORDINALITY AS ln(elem, pos)
    WHERE ${sql.join(cs, sql` AND `)} AND coalesce(ln.elem->>'accountCode', ln.elem->>'account', '') <> ''`;
  const base = baseOf(conds);
  const ledgerBase = narrowed ? baseOf(ledgerConds) : base;
  return scopedRead(async (tx) => {
    // Stored amounts must be non-negative integer strings (paise). A malformed row (a decimal, text, a negative) is
    // reported as a clear data error naming the voucher: never cast (which would 500 or silently round).
    const firstBadRow = async (b: SQL) => {
      const bad = await tx.execute(sql`
        SELECT j.voucher_no,
               coalesce(nullif(ln.elem->>'debitMinor', ''), nullif(ln.elem->>'debit', ''), '0') AS debit,
               coalesce(nullif(ln.elem->>'creditMinor', ''), nullif(ln.elem->>'credit', ''), '0') AS credit
        ${b}
          AND (coalesce(nullif(ln.elem->>'debitMinor', ''), nullif(ln.elem->>'debit', ''), '0') !~ '^[0-9]{1,38}$'
            OR coalesce(nullif(ln.elem->>'creditMinor', ''), nullif(ln.elem->>'credit', ''), '0') !~ '^[0-9]{1,38}$')
        ORDER BY j.posting_date, j.voucher_no LIMIT 1`);
      return (bad as unknown as Array<{ voucher_no: string }>)[0];
    };
    const totalsOf = async (b: SQL) => {
      const tot = await tx.execute(sql`
        SELECT count(*)::int AS lines, count(DISTINCT j.id)::int AS vouchers,
               count(DISTINCT coalesce(ln.elem->>'accountCode', ln.elem->>'account'))::int AS accounts,
               coalesce(sum(coalesce(nullif(ln.elem->>'debitMinor', ''), nullif(ln.elem->>'debit', ''), '0')::numeric(40,0)), 0)::text AS debit,
               coalesce(sum(coalesce(nullif(ln.elem->>'creditMinor', ''), nullif(ln.elem->>'credit', ''), '0')::numeric(40,0)), 0)::text AS credit
        ${b}`);
      const t = (tot as unknown as Array<{ lines: number; vouchers: number; accounts: number; debit: string; credit: string }>)[0];
      return {
        entryLines: t?.lines ?? 0, vouchers: t?.vouchers ?? 0, accountsActive: t?.accounts ?? 0,
        debitMinor: t?.debit ?? "0", creditMinor: t?.credit ?? "0",
      };
    };
    const badRow = await firstBadRow(base);
    if (badRow) {
      throw new HttpError(422, "LEDGER_AMOUNT_INVALID", `voucher ${badRow.voucher_no} has a debit or credit that is not a whole number of paise; fix the journal line before this view can total it`);
    }
    const rows = await tx.execute(sql`
      SELECT j.id AS journal_id, j.voucher_no, j.type, j.posting_date::text AS posting_date,
             coalesce(ln.elem->>'accountCode', ln.elem->>'account') AS account_code,
             ln.elem->>'narration' AS narration,
             coalesce(nullif(ln.elem->>'debitMinor', ''), nullif(ln.elem->>'debit', ''), '0')::numeric(40,0)::text AS debit,
             coalesce(nullif(ln.elem->>'creditMinor', ''), nullif(ln.elem->>'credit', ''), '0')::numeric(40,0)::text AS credit
      ${base}
      ORDER BY j.posting_date, j.voucher_no, j.id, ln.pos
      LIMIT ${f.limit} OFFSET ${f.offset}`);
    const totals = await totalsOf(base);
    // GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-04: the whole fiscal-year ledger, ignoring the tab and the search, so
    // the page can show a ledger-wide balance check next to the filtered footer. Equal to `totals` when nothing
    // narrows the set. `null` (unknown, never a made-up zero) if a stored amount OUTSIDE the filtered set is
    // malformed: the filtered view still works, only the ledger-wide figure is withheld.
    // Cost: when a tab or search is active this is two extra whole-fiscal-year jsonb scans (firstBadRow + totalsOf) per
    // page request. Deliberately NOT cached: this is the ledger-wide balance verdict, and a TTL-only cache (the GL has no
    // post-time invalidation of it, unlike the invalidateResource calls the budget/approvals reads rely on) would let a
    // just-posted journal leave the Balanced / Unbalanced card stale. If a large ledger shows latency, cache per
    // (tenant, fiscal year) AND invalidate it from the post / approve consumers, or serve it from a maintained summary.
    const ledgerTotals = !narrowed ? totals : (await firstBadRow(ledgerBase)) ? null : await totalsOf(ledgerBase);
    return { rows: rows as unknown as JournalLineRow[], totals, ledgerTotals };
  });
}
