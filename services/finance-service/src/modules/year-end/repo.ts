/**
 * UAT T-PERIOD year-end reads and the year-end close step (see year-end/domain.ts for the rules).
 *
 * Opening balances of a financial year: the gl.finance_opening_balances rows of that year when there are any (the
 * rows the year-end close generated -- source fy_close -- or the go-live balances an officer entered -- source
 * manual); otherwise DERIVED from the ledger: the latest earlier year that has stored rows (or inception) rolled
 * forward through every posting before the year starts. Either way only carry-forward heads open with a balance and
 * the income / expenditure net sits on the accumulated fund.
 * Every function runs in the caller transaction (tenant-scoped: RLS + explicit tenant_id filters).
 */
import { sql } from "drizzle-orm";
import { enqueue } from "../../shared/outbox.js";
import { fyBounds, nextFy } from "../../shared/ist-date.js";
import { headNatureOf, type HeadNature } from "../../shared/head-nature.js";
import { ACCUMULATED_FUND } from "../gl/system-heads.js";
import { DomainError } from "../masters/domain.js";
import { openPeriodsOfYear } from "../approvals/domain.js";
import { applyPendingBasisSwitchTx } from "../approvals/apply.js";
import { isCarryForwardHead, rollForward, toDrCr, lapseRow, lapseTotals, monthsOfFy, type HeadMovement, type LapseRow } from "./domain.js";

/** The caller transaction, typed as the outbox helper takes it (raw SQL via execute, plus enqueue). */
export type Tx = Parameters<typeof enqueue>[0];
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));

export type HeadInfo = { id: string; code: string; name: string; classification: string | null };

export async function headDirectory(tx: Tx, tenantId: string): Promise<Map<string, HeadInfo>> {
  const rows = rowsOf(await tx.execute(sql`
    SELECT id::text AS id, code, name, classification FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid
  `));
  return new Map(rows.map((r) => [String(r.code), { id: String(r.id), code: String(r.code), name: String(r.name), classification: (r.classification as string | null) ?? null }]));
}

/** Ledger debits / credits per head code between two dates (inclusive; null = unbounded). */
export async function ledgerMovements(tx: Tx, tenantId: string, from: string | null, to: string | null): Promise<HeadMovement[]> {
  const lower = from ? sql`AND fl.posting_date >= ${from}::date` : sql``;
  const upper = to ? sql`AND fl.posting_date <= ${to}::date` : sql``;
  const rows = rowsOf(await tx.execute(sql`
    SELECT fh.code, MAX(fh.name) AS name, MAX(fh.classification) AS classification,
           COALESCE(SUM(fl.debit_minor), 0)::text AS dr, COALESCE(SUM(fl.credit_minor), 0)::text AS cr
      FROM gl.finance_ledger fl
      JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id
     WHERE fl.tenant_id = ${tenantId}::uuid ${lower} ${upper}
     GROUP BY fh.code
  `));
  return rows.map((r) => ({ code: String(r.code), name: (r.name as string | null) ?? null, classification: (r.classification as string | null) ?? null, dr: big(r.dr), cr: big(r.cr) }));
}

export type StoredOpening = { accountCode: string; debitMinor: bigint; creditMinor: bigint; source: string };

export async function storedOpening(tx: Tx, tenantId: string, fy: string): Promise<StoredOpening[]> {
  const rows = rowsOf(await tx.execute(sql`
    SELECT account_code, debit_minor::text AS dr, credit_minor::text AS cr, source
      FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${fy}
  `));
  return rows.map((r) => ({ accountCode: String(r.account_code), debitMinor: big(r.dr), creditMinor: big(r.cr), source: String(r.source ?? "manual") }));
}

const signedMap = (rows: StoredOpening[]): Map<string, bigint> => {
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.accountCode, (m.get(r.accountCode) ?? 0n) + r.debitMinor - r.creditMinor);
  return m;
};

export type Opening = { source: "stored" | "derived"; balances: Map<string, bigint> };

export async function openingForFy(tx: Tx, tenantId: string, fy: string, dir?: Map<string, HeadInfo>): Promise<Opening> {
  const heads = dir ?? await headDirectory(tx, tenantId);
  const classify = (code: string) => ({ classification: heads.get(code)?.classification ?? null });
  const stored = await storedOpening(tx, tenantId, fy);
  if (stored.length > 0) return { source: "stored", balances: rollForward(signedMap(stored), [], classify, ACCUMULATED_FUND) };
  const [anchorRow] = rowsOf(await tx.execute(sql`
    SELECT MAX(fy_code) AS fy FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code < ${fy}
  `));
  const anchor = (anchorRow?.fy as string | null) ?? null;
  const base = anchor ? signedMap(await storedOpening(tx, tenantId, anchor)) : new Map<string, bigint>();
  const dayBefore = `${Number(fy.slice(0, 4))}-03-31`;
  const moves = await ledgerMovements(tx, tenantId, anchor ? fyBounds(anchor).start : null, dayBefore);
  return { source: "derived", balances: rollForward(base, moves, classify, ACCUMULATED_FUND) };
}

export type FyBalanceRow = {
  code: string; name: string; classification: string | null; nature: HeadNature; carryForward: boolean;
  openingMinor: bigint; debitMinor: bigint; creditMinor: bigint; closingMinor: bigint;
};

const FUND_NAME = "Accumulated Fund (surplus brought forward)";

/**
 * FY-bounded balances per head: opening (carry-forward heads + the fund only), this year debits / credits, closing.
 * `carried` is what the year closes INTO the next year: carry-forward closings, with the year net on the fund.
 */
export async function fyBalances(tx: Tx, tenantId: string, fy: string): Promise<{ opening: Opening; rows: FyBalanceRow[]; carried: Map<string, bigint> }> {
  const dir = await headDirectory(tx, tenantId);
  const opening = await openingForFy(tx, tenantId, fy, dir);
  const { start, end } = fyBounds(fy);
  const moves = await ledgerMovements(tx, tenantId, start, end);
  const byCode = new Map(moves.map((m) => [m.code, m]));
  const codes = [...new Set([...opening.balances.keys(), ...byCode.keys()])].sort();
  const rows: FyBalanceRow[] = codes.map((code) => {
    const h = dir.get(code); const m = byCode.get(code);
    const classification = h?.classification ?? m?.classification ?? (code === ACCUMULATED_FUND ? "equity" : null);
    const nature: HeadNature = code === ACCUMULATED_FUND ? "equity" : headNatureOf(code, classification);
    const o = opening.balances.get(code) ?? 0n; const dr = m?.dr ?? 0n; const cr = m?.cr ?? 0n;
    return {
      code, name: h?.name ?? m?.name ?? (code === ACCUMULATED_FUND ? FUND_NAME : code), classification, nature,
      carryForward: code === ACCUMULATED_FUND || isCarryForwardHead(code, classification),
      openingMinor: o, debitMinor: dr, creditMinor: cr, closingMinor: o + dr - cr,
    };
  });
  const classify = (code: string) => ({ classification: dir.get(code)?.classification ?? null });
  return { opening, rows, carried: rollForward(opening.balances, moves, classify, ACCUMULATED_FUND) };
}

/** Per-month opening / debit / credit / closing of one head in a financial year (debit-positive). */
export async function headMonthlyBalances(tx: Tx, tenantId: string, head: HeadInfo, fy: string) {
  const opening = await openingForFy(tx, tenantId, fy);
  const { start, end } = fyBounds(fy);
  const rows = rowsOf(await tx.execute(sql`
    SELECT to_char(posting_date, 'YYYY-MM') AS period, COALESCE(SUM(debit_minor), 0)::text AS dr, COALESCE(SUM(credit_minor), 0)::text AS cr
      FROM gl.finance_ledger
     WHERE tenant_id = ${tenantId}::uuid AND head_id = ${head.id}::uuid
       AND posting_date >= ${start}::date AND posting_date <= ${end}::date
     GROUP BY 1
  `));
  const byPeriod = new Map(rows.map((r) => [String(r.period), { dr: big(r.dr), cr: big(r.cr) }]));
  const carryForward = head.code === ACCUMULATED_FUND || isCarryForwardHead(head.code, head.classification);
  const openingMinor = opening.balances.get(head.code) ?? 0n;
  let running = openingMinor;
  const periods = monthsOfFy(fy).map((period) => {
    const m = byPeriod.get(period) ?? { dr: 0n, cr: 0n };
    const o = running; running = o + m.dr - m.cr;
    return { period, openingMinor: o, debitMinor: m.dr, creditMinor: m.cr, closingMinor: running };
  });
  return {
    head: { ...head, nature: head.code === ACCUMULATED_FUND ? "equity" : headNatureOf(head.code, head.classification), carryForward },
    openingMinor, closingMinor: running, periods, openingSource: opening.source,
  };
}

export async function lapseRowsForFy(tx: Tx, tenantId: string, fy: string): Promise<LapseRow[]> {
  const { start, end } = fyBounds(fy);
  const rows = rowsOf(await tx.execute(sql`
    SELECT b.id::text AS budget_id, b.head_id::text AS head_id, h.code, h.name,
           b.be_minor::text AS be, b.re_minor::text AS re,
           -- #2464 review: expenditure from the LEDGER (net debits of the head in the FY), the same source as Budget
           -- Monitoring / Expended (monitoring-books.ts): reversals and recoveries reduce it. utilised_minor stays the
           -- control figure only (it is never released by a reversal).
           COALESCE((SELECT SUM(fl.debit_minor) - SUM(fl.credit_minor) FROM gl.finance_ledger fl
                      WHERE fl.tenant_id = b.tenant_id AND fl.head_id = b.head_id
                        AND fl.posting_date >= ${start}::date AND fl.posting_date <= ${end}::date), 0)::text AS expended
      FROM budget.finance_budgets b
      JOIN budget.finance_heads h ON h.id = b.head_id AND h.tenant_id = b.tenant_id
     WHERE b.tenant_id = ${tenantId}::uuid AND b.fy = ${fy}
     ORDER BY h.code
  `));
  return rows.map((r) => lapseRow({
    budgetId: String(r.budget_id), headId: String(r.head_id), headCode: String(r.code), headName: String(r.name),
    beMinor: big(r.be), reMinor: big(r.re), expenditureMinor: big(r.expended),
  }));
}

export async function lapseRecorded(tx: Tx, tenantId: string, fy: string): Promise<{ recordedAt: string; recordedBy: string } | null> {
  const [r] = rowsOf(await tx.execute(sql`
    SELECT MAX(recorded_at) AS at, (ARRAY_AGG(recorded_by::text ORDER BY recorded_at DESC))[1] AS by
      FROM budget.finance_budget_lapses WHERE tenant_id = ${tenantId}::uuid AND fy = ${fy}
  `));
  if (!r || !r.at) return null;
  return { recordedAt: new Date(r.at as string).toISOString(), recordedBy: String(r.by) };
}

/** Budget ids whose FY lapse has been recorded by the year-end close (the budgets list shows them as lapsed). */
export async function lapsedBudgetIds(tx: Tx, tenantId: string): Promise<Set<string>> {
  const rows = rowsOf(await tx.execute(sql`SELECT budget_id::text AS id FROM budget.finance_budget_lapses WHERE tenant_id = ${tenantId}::uuid`));
  return new Set(rows.map((r) => String(r.id)));
}

export async function yearEndRun(tx: Tx, tenantId: string, fy: string) {
  const [r] = rowsOf(await tx.execute(sql`
    SELECT next_fy_code, opening_balance_count, fund_carried_minor::text AS fund, lapse_total_minor::text AS lapse, run_count, run_by::text AS run_by, run_at
      FROM gl.finance_year_end_runs WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${fy}
  `));
  return r ? {
    nextFiscalYear: String(r.next_fy_code), openingBalanceCount: Number(r.opening_balance_count), fundCarriedMinor: String(r.fund),
    lapseTotalMinor: String(r.lapse), runCount: Number(r.run_count), runBy: String(r.run_by), runAt: new Date(r.run_at as string).toISOString(),
  } : null;
}

/** The conditions the year-end close needs; throws the DomainError the route answers 404 / 409 with. */
export async function checkYearEndClose(tx: Tx, tenantId: string, fy: string): Promise<{ next: string }> {
  const [year] = rowsOf(await tx.execute(sql`
    SELECT start_date::text AS start_date, end_date::text AS end_date FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid AND code = ${fy}
  `));
  if (!year) throw new DomainError("NOT_FOUND", `fiscal year ${fy} not found`);
  const periods = rowsOf(await tx.execute(sql`SELECT period, status FROM gl.finance_period_close WHERE tenant_id = ${tenantId}::uuid`))
    .map((r) => ({ period: String(r.period), status: String(r.status) }));
  const open = openPeriodsOfYear({ startDate: String(year.start_date), endDate: String(year.end_date) }, periods);
  if (open.length > 0) {
    throw new DomainError("FY_OPEN_PERIODS", `fiscal year ${fy} still has ${open.length} period(s) that are not hard-closed (${open.slice(0, 3).join(", ")}${open.length > 3 ? ", ..." : ""}); hard-close every month before the year-end close`);
  }
  const next = nextFy(fy);
  const [manual] = rowsOf(await tx.execute(sql`
    SELECT count(*)::int AS n FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${next} AND source = 'manual'
  `));
  if (Number(manual?.n ?? 0) > 0) {
    throw new DomainError("OPENING_BALANCES_MANUAL", `opening balances for ${next} were entered by hand (${manual?.n} row(s)); the year-end close will not overwrite them -- review them with the finance admin`);
  }
  return { next };
}

export type YearEndResult = { fy: string; next: string; openingBalanceCount: number; fundCarriedMinor: bigint; lapseTotalMinor: bigint; changed: boolean; lapseRows: number };

/**
 * The year-end close for `fy`, in the caller transaction: (1) generate the next year opening balances for the
 * carry-forward heads + the accumulated fund (replacing the rows a previous run generated; idempotent -- an unchanged
 * ledger writes nothing new); (2) record the 31 March lapse statement; (3) record the run; (4) audit. Validates first.
 */
export async function applyYearEndClose(tx: Tx, meta: { tenantId: string; actorId: string; correlationId: string }, p: { fy: string; reason: string }): Promise<YearEndResult> {
  const tenantId = meta.tenantId;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`year_end:${tenantId}`}))`);
  const { next } = await checkYearEndClose(tx, tenantId, p.fy);
  const { carried } = await fyBalances(tx, tenantId, p.fy);
  const wanted = [...carried.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = wanted.reduce((s, [, v]) => s + v, 0n);
  if (total !== 0n) throw new DomainError("OPENING_BALANCES_UNBALANCED", `the ledger for ${p.fy} does not balance (difference ${total} paise); fix it before the year-end close`);
  const previous = signedMap((await storedOpening(tx, tenantId, next)).filter((r) => r.source === "fy_close"));
  const changed = previous.size !== wanted.length || wanted.some(([code, v]) => previous.get(code) !== v);
  if (changed) {
    await tx.execute(sql`DELETE FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${next} AND source = 'fy_close'`);
    for (const [code, v] of wanted) {
      const { debitMinor, creditMinor } = toDrCr(v);
      await tx.execute(sql`
        INSERT INTO gl.finance_opening_balances (tenant_id, fy_code, account_code, debit_minor, credit_minor, narration, entered_by, source)
        VALUES (${tenantId}::uuid, ${next}, ${code}, ${debitMinor.toString()}::bigint, ${creditMinor.toString()}::bigint,
                ${`Brought forward from ${p.fy} (year-end close)`}, ${meta.actorId}::uuid, 'fy_close')
      `);
    }
  }
  const lapse = await lapseRowsForFy(tx, tenantId, p.fy);
  for (const r of lapse) {
    await tx.execute(sql`
      INSERT INTO budget.finance_budget_lapses (tenant_id, fy, head_id, budget_id, be_minor, re_minor, expenditure_minor, lapse_minor, excess_minor, recorded_by)
      VALUES (${tenantId}::uuid, ${p.fy}, ${r.headId}::uuid, ${r.budgetId}::uuid, ${r.beMinor.toString()}::bigint, ${r.reMinor.toString()}::bigint,
              ${r.expenditureMinor.toString()}::bigint, ${r.lapseMinor.toString()}::bigint, ${r.excessMinor.toString()}::bigint, ${meta.actorId}::uuid)
      ON CONFLICT (tenant_id, fy, head_id) DO UPDATE SET budget_id = EXCLUDED.budget_id, be_minor = EXCLUDED.be_minor, re_minor = EXCLUDED.re_minor,
        expenditure_minor = EXCLUDED.expenditure_minor, lapse_minor = EXCLUDED.lapse_minor, excess_minor = EXCLUDED.excess_minor,
        recorded_by = EXCLUDED.recorded_by, recorded_at = now()
    `);
  }
  const totals = lapseTotals(lapse);
  const fund = carried.get(ACCUMULATED_FUND) ?? 0n;
  await tx.execute(sql`
    INSERT INTO gl.finance_year_end_runs (tenant_id, fy_code, next_fy_code, opening_balance_count, fund_carried_minor, lapse_total_minor, reason, run_by)
    VALUES (${tenantId}::uuid, ${p.fy}, ${next}, ${wanted.length}, ${(-fund).toString()}::bigint, ${totals.lapseMinor.toString()}::bigint, ${p.reason}, ${meta.actorId}::uuid)
    ON CONFLICT (tenant_id, fy_code) DO UPDATE SET next_fy_code = EXCLUDED.next_fy_code, opening_balance_count = EXCLUDED.opening_balance_count,
      fund_carried_minor = EXCLUDED.fund_carried_minor, lapse_total_minor = EXCLUDED.lapse_total_minor, reason = EXCLUDED.reason,
      run_by = EXCLUDED.run_by, run_at = now(), run_count = gl.finance_year_end_runs.run_count + 1
  `);
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: {
      service: "finance", action: "year_end_close", resourceType: "fiscal_year", resourceId: p.fy, outcome: "success",
      nextFiscalYear: next, openingBalanceCount: wanted.length, openingBalancesChanged: changed,
      fundCarriedMinor: (-fund).toString(), lapseRows: lapse.length, lapseTotalMinor: totals.lapseMinor.toString(),
      excessTotalMinor: totals.excessMinor.toString(), reason: p.reason,
    },
  });
  // Owner decision 3: every period of `fy` is hard-closed, so an approved accounting-basis switch dated at the start of `next` takes effect now.
  await applyPendingBasisSwitchTx(tx as never, meta, fyBounds(next).start);
  return { fy: p.fy, next, openingBalanceCount: wanted.length, fundCarriedMinor: -fund, lapseTotalMinor: totals.lapseMinor, changed, lapseRows: lapse.length };
}
