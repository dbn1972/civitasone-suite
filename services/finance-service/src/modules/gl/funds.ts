/**
 * Section 8 NF-1 (docs/design/SECTION8-NONPROFIT-FINANCE.md §2.3, §2.4): the fund master's data access and the per-fund posting
 * rules. Everything here runs inside the caller's transaction (tenant-scoped, RLS + explicit tenant_id filters), and the
 * posting-time functions are STRICT NO-OPS when fund accounting is off (they return before touching the database).
 *
 *  - ensureGeneralFundTx           the auto-created GENERAL (unrestricted) fund every fund-accounted tenant has.
 *  - coalesceFundSql               THE shared "NULL fund_id = GENERAL" read helper (every per-fund read uses it).
 *  - assertFundsBalanced           per-(journal, fund) debit = credit, before the deferred DB constraint backs it up.
 *  - prepareFundPostingTx          validates + row-locks the funds a journal touches and refuses a restricted overspend.
 *  - fundBalanceTx                 computed-on-read fund balance (no gl.fund_balances table).
 *  - buildInterFundTransfer / buildFundRelease   the paired due-to / due-from journal shapes (pure).
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { DomainError } from "../approvals/domain.js";
import { headNatureOf } from "../../shared/head-nature.js";
import { financeHeads } from "../budget/schema.js";
import { funds, type FundRow, type FundType, type JournalLine } from "./schema.js";
import type { FundContext } from "./fund-context.js";

export const GENERAL_FUND_CODE = "GENERAL";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chart codes of the inter-fund heads (NF-2 supplies the nonprofit chart; configurable like every system head). */
export const FUND_HEADS = {
  dueTo: process.env.FINANCE_FUND_DUE_TO_CODE ?? "2900",           // liability: owed to another fund
  dueFrom: process.env.FINANCE_FUND_DUE_FROM_CODE ?? "1900",       // asset: owed by another fund
  transferOut: process.env.FINANCE_FUND_TRANSFER_OUT_CODE ?? "3910", // equity: inter-fund transfer out
  transferIn: process.env.FINANCE_FUND_TRANSFER_IN_CODE ?? "3911",   // equity: inter-fund transfer in
  releaseOut: process.env.FINANCE_FUND_RELEASE_OUT_CODE ?? "3920",   // equity: released from restriction (out of the restricted fund)
  releaseIn: process.env.FINANCE_FUND_RELEASE_IN_CODE ?? "3921",     // equity: released from restriction (into the receiving fund)
} as const;

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * THE shared read helper: a row whose fund_id is NULL (pre-flag history, every govt tenant) belongs to the tenant's GENERAL
 * fund. Every per-fund read goes through this fragment so no query can invent a "missing" bucket. `generalFundId` is read
 * once by the caller (generalFundIdTx); with no GENERAL fund the NULL bucket keeps the zero uuid, which no real fund has.
 */
export function coalesceFundSql(column: SQL | string, generalFundId: string | null): SQL {
  const col = typeof column === "string" ? sql.raw(column) : column;
  return sql`COALESCE(${col}, ${generalFundId ?? ZERO_UUID}::uuid)`;
}

export async function generalFundIdTx(tx: Tx, tenantId: string): Promise<string | null> {
  const r = await tx.select({ id: funds.id }).from(funds).where(and(eq(funds.tenantId, tenantId), eq(funds.code, GENERAL_FUND_CODE))).limit(1);
  return r[0]?.id ?? null;
}

/** Create the tenant's GENERAL (unrestricted, non-FCRA) fund if it does not exist; return its id. Idempotent. */
export async function ensureGeneralFundTx(tx: Tx, tenantId: string, actorId: string): Promise<string> {
  await tx.insert(funds).values({
    tenantId, code: GENERAL_FUND_CODE, name: "General Fund", type: "unrestricted", fcra: false,
    sourceCondition: null, status: "active", createdBy: actorId, updatedBy: actorId,
  }).onConflictDoNothing({ target: [funds.tenantId, funds.code] });
  const id = await generalFundIdTx(tx, tenantId);
  if (!id) throw new DomainError("FUND_ACCOUNTING_NOT_READY", "the GENERAL fund could not be created");
  return id;
}

// ---- per-fund balancing ------------------------------------------------------------------------------------------------

export type FundedJournalLine = Pick<JournalLine, "debitMinor" | "creditMinor"> & { fund: string | null };

/**
 * A journal can balance overall yet be unbalanced within a fund (design 2.4). Per (fund) debit must equal credit. Applies only
 * when at least one line is fund-tagged; a journal whose lines all have no fund (govt) is not checked here -- a strict no-op,
 * exactly like the deferred database constraint it mirrors (gl.check_journal_balance, migration 0171).
 */
export function assertFundsBalanced(lines: ReadonlyArray<FundedJournalLine>): void {
  if (!lines.some((l) => l.fund !== null)) return;
  const net = new Map<string, bigint>();
  for (const l of lines) {
    const k = l.fund ?? "";
    net.set(k, (net.get(k) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
  }
  for (const [k, v] of net) {
    if (v !== 0n) {
      throw new DomainError(
        "JOURNAL_FUND_UNBALANCED",
        `journal does not balance within fund ${k || "(no fund)"}: net ${v} paise. Move value between funds with an inter-fund transfer (paired due-to / due-from heads)`,
      );
    }
  }
}

// ---- opening balances --------------------------------------------------------------------------------------------------

type OpeningFundEntry = { accountCode: string; fundId?: string | null | undefined; debitMinor: bigint | number | string; creditMinor: bigint | number | string };
const GENERAL_KEY = "\u0000general";

/**
 * Two opening-balance rows collide when they are for the same account AND the same fund. A NULL fund is the GENERAL fund (the
 * shared NULL = GENERAL rule), so an untagged row never collides with a row of another fund. With no fund anywhere (govt) this
 * is exactly the old "same account" rule.
 */
export function openingEntryConflicts(existing: ReadonlyArray<Pick<OpeningFundEntry, "accountCode" | "fundId">>, entry: Pick<OpeningFundEntry, "accountCode" | "fundId">): boolean {
  return existing.some((r) => r.accountCode === entry.accountCode && (r.fundId ?? GENERAL_KEY) === (entry.fundId ?? GENERAL_KEY));
}

/** When any opening entry names a fund, each fund's entries must balance on their own. No fund anywhere => no-op. */
export function assertOpeningBalancedPerFund(entries: ReadonlyArray<OpeningFundEntry>): void {
  if (!entries.some((e) => e.fundId)) return;
  const net = new Map<string, bigint>();
  for (const e of entries) {
    const k = e.fundId ?? GENERAL_KEY;
    net.set(k, (net.get(k) ?? 0n) + BigInt(e.debitMinor) - BigInt(e.creditMinor));
  }
  for (const [k, v] of net) {
    if (v !== 0n) throw new DomainError("OPENING_BALANCES_UNBALANCED", `opening balances do not balance within fund ${k === GENERAL_KEY ? "GENERAL" : k}: net ${v} paise`);
  }
}

// ---- spend rule --------------------------------------------------------------------------------------------------------

/** The natures that make up a fund's available balance: its income, its expenditure and its fund (equity) accounts. */
export const FUND_BALANCE_NATURES: ReadonlySet<string> = new Set(["income", "expense", "equity"]);

export type HeadRef = { code: string; classification: string | null };
/** credit - debit of a head, counted only when its nature is part of the fund balance. */
export function fundDeltaMinor(head: HeadRef, debitMinor: bigint, creditMinor: bigint): bigint {
  return FUND_BALANCE_NATURES.has(headNatureOf(head.code, head.classification)) ? creditMinor - debitMinor : 0n;
}

/**
 * The spend rule for one fund in one journal. `balanceMinor` is the fund's balance BEFORE the journal, `deltaMinor` the
 * journal's effect on it (negative = spend / transfer out).
 *   restricted: refuse when the journal would take the balance below zero ("cannot exceed balance");
 *   corpus:     refuse any net reduction (the corpus is held, not spent);
 *   unrestricted / designated: no balance limit (GENERAL may run a deficit; designation is a board choice).
 */
export function assertFundSpend(fund: Pick<FundRow, "code" | "type">, balanceMinor: bigint, deltaMinor: bigint): void {
  if (deltaMinor >= 0n) return;
  if (fund.type === "corpus") {
    throw new DomainError("FUND_CORPUS_NOT_SPENDABLE", `fund ${fund.code} is a corpus fund; its balance cannot be reduced (net ${deltaMinor} paise)`);
  }
  if (fund.type === "restricted" && balanceMinor + deltaMinor < 0n) {
    throw new DomainError(
      "FUND_BALANCE_EXCEEDED",
      `fund ${fund.code} is restricted: spending ${-deltaMinor} paise exceeds its balance of ${balanceMinor} paise`,
    );
  }
}

type ResolvedHead = { id: string; code: string; classification: string | null };

async function headsByRefTx(tx: Tx, tenantId: string, refs: readonly string[]): Promise<Map<string, ResolvedHead>> {
  const out = new Map<string, ResolvedHead>();
  const wanted = [...new Set(refs.filter((r) => typeof r === "string" && r.trim() !== ""))];
  if (wanted.length === 0) return out;
  const ids = wanted.filter((r) => UUID_RE.test(r));
  const codes = wanted.filter((r) => !UUID_RE.test(r));
  const rows: Array<{ id: string; code: string; classification: string | null }> = await tx
    .select({ id: financeHeads.id, code: financeHeads.code, classification: financeHeads.classification })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), or(
      ...(codes.length ? [inArray(financeHeads.code, codes)] : []),
      ...(ids.length ? [inArray(financeHeads.id, ids)] : []),
    )));
  for (const h of rows) { out.set(h.code, h); out.set(h.id, h); }
  return out;
}

/** Computed-on-read balance of one fund: ledger credit-debit over income / expense / equity heads, + go-live opening rows. */
export async function fundBalanceTx(tx: Tx, tenantId: string, fundId: string): Promise<bigint> {
  const ledger = rowsOf(await tx.execute(sql`
    SELECT fh.code, fh.classification, COALESCE(SUM(fl.debit_minor), 0)::text AS dr, COALESCE(SUM(fl.credit_minor), 0)::text AS cr
      FROM gl.finance_ledger fl JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id
     WHERE fl.tenant_id = ${tenantId}::uuid AND fl.fund_id = ${fundId}::uuid
     GROUP BY fh.code, fh.classification
  `));
  let bal = 0n;
  for (const r of ledger) bal += fundDeltaMinor({ code: String(r.code), classification: (r.classification as string | null) ?? null }, big(r.dr), big(r.cr));
  // Go-live balances an officer entered (source 'manual') are not in the ledger. fy_close rows are derived from it: skipped.
  const opening = rowsOf(await tx.execute(sql`
    SELECT ob.account_code AS code, MAX(fh.classification) AS classification,
           COALESCE(SUM(ob.debit_minor), 0)::text AS dr, COALESCE(SUM(ob.credit_minor), 0)::text AS cr
      FROM gl.finance_opening_balances ob
      LEFT JOIN budget.finance_heads fh ON fh.tenant_id = ob.tenant_id AND fh.code = ob.account_code
     WHERE ob.tenant_id = ${tenantId}::uuid AND ob.fund_id = ${fundId}::uuid AND ob.source = 'manual'
     GROUP BY ob.account_code
  `));
  for (const r of opening) bal += fundDeltaMinor({ code: String(r.code), classification: (r.classification as string | null) ?? null }, big(r.dr), big(r.cr));
  return bal;
}

/**
 * Posting-time fund checks for ONE journal, in the posting transaction. Strict no-op (returns at once, no query) when the
 * context is disabled. Otherwise:
 *  1. every fund the journal touches must exist (RLS-scoped) and be active (FUND_NOT_FOUND / FUND_CLOSED);
 *  2. the fund rows are locked FOR UPDATE in id order, serialising concurrent spends on the same fund, so the balance read
 *     below is never stale by the time the ledger rows are written (restricted overspend under concurrency);
 *  3. each fund balances within itself (assertFundsBalanced);
 *  4. fund_transfer / fund_release journals obey their fund-type rules;
 *  5. a restricted / corpus fund that the journal reduces must have the balance for it (assertFundSpend).
 */
export async function prepareFundPostingTx(
  tx: Tx, fx: FundContext, tenantId: string, journal: { type: string; lines: ReadonlyArray<JournalLine> },
): Promise<void> {
  if (!fx.enabled) return;
  const funded: Array<FundedJournalLine & { ref: string }> = journal.lines.map((l) => ({
    debitMinor: l.debitMinor, creditMinor: l.creditMinor, fund: fx.fundOfLine(l), ref: l.accountCode,
  }));
  assertFundsBalanced(funded);
  const fundIds = [...new Set(funded.map((l) => l.fund as string))].sort();
  const rows: FundRow[] = await tx.select().from(funds)
    .where(and(eq(funds.tenantId, tenantId), inArray(funds.id, fundIds))).orderBy(funds.id).for("update");
  const byId = new Map(rows.map((f) => [f.id, f]));
  for (const id of fundIds) {
    const f = byId.get(id);
    if (!f) throw new DomainError("FUND_NOT_FOUND", `fund ${id} does not exist for this tenant`);
    if (f.status !== "active") throw new DomainError("FUND_CLOSED", `fund ${f.code} is closed and cannot take postings`);
  }
  if (journal.type === "fund_transfer" || journal.type === "fund_release") assertTransferShape(journal.type, journal.lines, funded, byId);
  const spendable = fundIds.filter((id) => ["restricted", "corpus"].includes((byId.get(id) as FundRow).type));
  if (spendable.length === 0) return;
  const heads = await headsByRefTx(tx, tenantId, funded.map((l) => l.ref));
  for (const id of spendable) {
    let delta = 0n;
    funded.forEach((l, i) => {
      if (l.fund !== id) return;
      const h = heads.get(journal.lines[i]?.accountCode ?? "");
      if (h) delta += fundDeltaMinor(h, BigInt(l.debitMinor), BigInt(l.creditMinor));
    });
    if (delta >= 0n) continue;
    assertFundSpend(byId.get(id) as FundRow, await fundBalanceTx(tx, tenantId, id), delta);
  }
}

function assertTransferShape(
  type: "fund_transfer" | "fund_release", lines: ReadonlyArray<JournalLine>, funded: ReadonlyArray<FundedJournalLine>, byId: ReadonlyMap<string, FundRow>,
): void {
  const ids = [...new Set(funded.map((l) => l.fund as string))];
  if (ids.length !== 2) throw new DomainError("FUND_TRANSFER_SHAPE", `a ${type} journal moves value between exactly two funds (got ${ids.length})`);
  const outCode = type === "fund_transfer" ? FUND_HEADS.transferOut : FUND_HEADS.releaseOut;
  const src = funded.find((l, i) => lines[i]?.accountCode === outCode && BigInt(l.debitMinor) > 0n);
  if (!src) throw new DomainError("FUND_TRANSFER_SHAPE", `a ${type} journal must debit head ${outCode} in the source fund`);
  const from = byId.get(src.fund as string) as FundRow;
  const to = byId.get(ids.find((i) => i !== src.fund) as string) as FundRow;
  if (type === "fund_release") {
    if (from.type !== "restricted") throw new DomainError("FUND_RELEASE_SOURCE", `fund ${from.code} is ${from.type}; only a restricted fund can be released from restriction`);
    if (to.type !== "unrestricted" && to.type !== "designated") throw new DomainError("FUND_RELEASE_TARGET", `a released amount moves into an unrestricted or designated fund, not ${to.type} fund ${to.code}`);
  }
  if (from.fcra !== to.fcra) throw new DomainError("FUND_FCRA_BOUNDARY", `fund ${from.code} and ${to.code} differ in FCRA status; foreign-contribution money cannot cross that boundary by transfer`);
}

// ---- inter-fund transfer / release-from-restriction (pure builders) ----------------------------------------------------------

export type FundMoveInput = { fromFundId: string; toFundId: string; amountMinor: bigint; narration?: string | undefined };

function movePair(out: string, inn: string, m: FundMoveInput): JournalLine[] {
  if (m.fromFundId === m.toFundId) throw new DomainError("FUND_TRANSFER_SAME_FUND", "source and destination fund must differ");
  if (m.amountMinor <= 0n) throw new DomainError("FUND_TRANSFER_AMOUNT", "the amount must be greater than zero");
  const n = m.narration ? { narration: m.narration } : {};
  return [
    // source fund: its fund balance falls, and it now owes the destination fund   (Dr transfer-out / Cr due-to)
    { accountCode: out, debitMinor: m.amountMinor, creditMinor: 0n, fundId: m.fromFundId, ...n },
    { accountCode: FUND_HEADS.dueTo, debitMinor: 0n, creditMinor: m.amountMinor, fundId: m.fromFundId, ...n },
    // destination fund: it is owed by the source fund, and its fund balance rises (Dr due-from / Cr transfer-in)
    { accountCode: FUND_HEADS.dueFrom, debitMinor: m.amountMinor, creditMinor: 0n, fundId: m.toFundId, ...n },
    { accountCode: inn, debitMinor: 0n, creditMinor: m.amountMinor, fundId: m.toFundId, ...n },
  ];
}

/** Inter-fund transfer: each fund's side balances within itself; the due-to / due-from pair eliminates in total. */
export const buildInterFundTransfer = (m: FundMoveInput): JournalLine[] => movePair(FUND_HEADS.transferOut, FUND_HEADS.transferIn, m);
/** Release from restriction: same shape on the release heads; the source must be restricted (checked again at posting). */
export const buildFundRelease = (m: FundMoveInput): JournalLine[] => movePair(FUND_HEADS.releaseOut, FUND_HEADS.releaseIn, m);

/** Every head a transfer / release journal needs must exist in the tenant's chart, else refuse (fail-closed, not a 500). */
export async function assertFundHeadsPresentTx(tx: Tx, tenantId: string, codes: readonly string[]): Promise<void> {
  const found = await headsByRefTx(tx, tenantId, codes);
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length > 0) {
    throw new DomainError("FUND_HEADS_MISSING", `the nonprofit chart is missing head(s) ${missing.join(", ")}; inter-fund journals cannot post`);
  }
}

export type { FundRow, FundType };
