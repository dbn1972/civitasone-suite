/**
 * Section 8 NF-1 (docs/design/SECTION8-NONPROFIT-FINANCE.md §2.2, §2.3): the per-fund year-end close -- `fundYearEndRollover`.
 *
 * NEW functions selected by settings; the govt `rollForward` / `fyBalances` / `openingForFy` and the delete-and-reinsert in
 * year-end/repo.ts are left UNTOUCHED. applyYearEndClose (repo.ts) calls this only when fund_accounting is ON.
 *
 * Everything groups by (head, fund). A row with fund_id NULL (pre-flag history) is the GENERAL fund -- via the one shared
 * `coalesceFundSql` helper -- so it lands in the GENERAL bucket, never a missing one. Each fund is rolled forward with the
 * SAME pure `rollForward` the govt close uses (carry-forward heads keep their balance, income and expenditure net into
 * the fund's own accumulated-fund line), and each fund's carry-forward must sum to zero on its own (a fund that does not
 * balance stops the close, naming the fund).
 *
 * NF-7: the inter-fund movement heads (transfer / release, in and out) are then folded into each fund's accumulated-fund line
 * (rollFund), so they open every new year at zero instead of accumulating; see year-end/domain.ts rollInterFundHeads.
 */
import { sql } from "drizzle-orm";
import { fyBounds } from "../../shared/ist-date.js";
import { ACCUMULATED_FUND, INTER_FUND_MOVEMENT_CODES } from "../gl/system-heads.js";
import { coalesceFundSql } from "../gl/funds.js";
import { fundContext } from "../gl/fund-context.js";
import { DomainError } from "../masters/domain.js";
import { rollForward, rollInterFundHeads, toDrCr, type HeadMovement } from "./domain.js";
import { headDirectory, type Tx } from "./repo.js";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));

export type FundMovement = HeadMovement & { fundId: string };
type FundOpeningRow = { fundId: string; accountCode: string; signed: bigint; source: string };

export async function fundLedgerMovements(tx: Tx, tenantId: string, general: string, from: string | null, to: string | null): Promise<FundMovement[]> {
  const lower = from ? sql`AND fl.posting_date >= ${from}::date` : sql``;
  const upper = to ? sql`AND fl.posting_date <= ${to}::date` : sql``;
  // The fund expression binds the GENERAL uuid as a parameter; repeating it in GROUP BY would be a different expression
  // ($N vs $M) and Postgres rejects it, so the grouping is positional (GROUP BY 1).
  const fund = coalesceFundSql("fl.fund_id", general);
  const rows = rowsOf(await tx.execute(sql`
    SELECT ${fund}::text AS fund_id, fh.code, MAX(fh.name) AS name, MAX(fh.classification) AS classification,
           COALESCE(SUM(fl.debit_minor), 0)::text AS dr, COALESCE(SUM(fl.credit_minor), 0)::text AS cr
      FROM gl.finance_ledger fl
      JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id
     WHERE fl.tenant_id = ${tenantId}::uuid ${lower} ${upper}
     GROUP BY 1, fh.code
  `));
  return rows.map((r) => ({
    fundId: String(r.fund_id), code: String(r.code), name: (r.name as string | null) ?? null,
    classification: (r.classification as string | null) ?? null, dr: big(r.dr), cr: big(r.cr),
  }));
}

async function fundStoredOpening(tx: Tx, tenantId: string, general: string, fy: string): Promise<FundOpeningRow[]> {
  const fund = coalesceFundSql("fund_id", general);
  const rows = rowsOf(await tx.execute(sql`
    SELECT ${fund}::text AS fund_id, account_code, debit_minor::text AS dr, credit_minor::text AS cr, source
      FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${fy}
  `));
  return rows.map((r) => ({ fundId: String(r.fund_id), accountCode: String(r.account_code), signed: big(r.dr) - big(r.cr), source: String(r.source ?? "manual") }));
}

/**
 * NF-7: ONE fund's year roll = the shared govt `rollForward` (income / expenditure into the accumulated fund) followed by the
 * inter-fund movement roll (3910/3911/3920/3921 into the same accumulated fund). Only the per-fund (fund_accounting ON) path
 * calls this; the govt close never does.
 */
const rollFund = (base: ReadonlyMap<string, bigint>, moves: ReadonlyArray<HeadMovement>, classify: (code: string) => { classification: string | null }): Map<string, bigint> =>
  rollInterFundHeads(rollForward(base, moves, classify, ACCUMULATED_FUND), INTER_FUND_MOVEMENT_CODES(), ACCUMULATED_FUND);

const perFund = <T extends { fundId: string }>(items: readonly T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const i of items) { const l = m.get(i.fundId); if (l) l.push(i); else m.set(i.fundId, [i]); }
  return m;
};

const signedByCode = (rows: readonly FundOpeningRow[]): Map<string, bigint> => {
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.accountCode, (m.get(r.accountCode) ?? 0n) + r.signed);
  return m;
};

/** Per-fund opening balances of `fy`: stored rows when the year has any, else derived from the ledger (like openingForFy). */
export async function fundOpeningForFy(tx: Tx, tenantId: string, general: string, fy: string, dir?: Map<string, { classification: string | null }>): Promise<Map<string, Map<string, bigint>>> {
  const heads = dir ?? await headDirectory(tx, tenantId);
  const classify = (code: string) => ({ classification: heads.get(code)?.classification ?? null });
  const out = new Map<string, Map<string, bigint>>();
  const stored = await fundStoredOpening(tx, tenantId, general, fy);
  if (stored.length > 0) {
    for (const [fundId, rows] of perFund(stored)) out.set(fundId, rollFund(signedByCode(rows), [], classify));
    return out;
  }
  const [anchorRow] = rowsOf(await tx.execute(sql`
    SELECT MAX(fy_code) AS fy FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code < ${fy}
  `));
  const anchor = (anchorRow?.fy as string | null) ?? null;
  const base = anchor ? perFund(await fundStoredOpening(tx, tenantId, general, anchor)) : new Map<string, FundOpeningRow[]>();
  const dayBefore = `${Number(fy.slice(0, 4))}-03-31`;
  const moves = perFund(await fundLedgerMovements(tx, tenantId, general, anchor ? fyBounds(anchor).start : null, dayBefore));
  for (const fundId of new Set([...base.keys(), ...moves.keys()])) {
    out.set(fundId, rollFund(signedByCode(base.get(fundId) ?? []), moves.get(fundId) ?? [], classify));
  }
  return out;
}

/** What each fund carries into the next year: opening + this year's movements rolled forward, per fund. */
export async function fundCarriedForFy(tx: Tx, tenantId: string, general: string, fy: string): Promise<Map<string, Map<string, bigint>>> {
  const dir = await headDirectory(tx, tenantId);
  const classify = (code: string) => ({ classification: dir.get(code)?.classification ?? null });
  const opening = await fundOpeningForFy(tx, tenantId, general, fy, dir);
  const { start, end } = fyBounds(fy);
  const moves = perFund(await fundLedgerMovements(tx, tenantId, general, start, end));
  const carried = new Map<string, Map<string, bigint>>();
  for (const fundId of new Set([...opening.keys(), ...moves.keys()])) {
    carried.set(fundId, rollFund(opening.get(fundId) ?? new Map(), moves.get(fundId) ?? [], classify));
  }
  return carried;
}

export type FundYearEndResult = { openingBalanceCount: number; changed: boolean; fundCarriedMinor: bigint };

/**
 * Generate the next year's per-fund opening balances (source 'fy_close'), replacing the rows a previous run generated
 * (idempotent: an unchanged ledger writes nothing). Runs in the year-end transaction after checkYearEndClose; the caller then
 * records the lapse memo, the run and the audit exactly as the govt close does. Refused (FUND_ACCOUNTING_NOT_READY) when the
 * GENERAL fund does not exist.
 */
export async function fundYearEndRollover(
  tx: Tx, meta: { tenantId: string; actorId: string }, p: { fy: string; next: string; reason: string },
): Promise<FundYearEndResult> {
  const tenantId = meta.tenantId;
  const fx = await fundContext(tx, tenantId);
  if (!fx.enabled || !fx.generalFundId) throw new DomainError("FUND_ACCOUNTING_NOT_READY", "the per-fund year-end close needs fund accounting on");
  const general = fx.generalFundId;
  const carried = await fundCarriedForFy(tx, tenantId, general, p.fy);
  const wanted: Array<{ fundId: string; code: string; v: bigint }> = [];
  for (const fundId of [...carried.keys()].sort()) {
    const m = carried.get(fundId) as Map<string, bigint>;
    const total = [...m.values()].reduce((s, v) => s + v, 0n);
    if (total !== 0n) throw new DomainError("OPENING_BALANCES_UNBALANCED", `fund ${fundId} for ${p.fy} does not balance (difference ${total} paise); fix it before the year-end close`);
    for (const [code, v] of [...m.entries()].sort(([a], [b]) => a.localeCompare(b))) wanted.push({ fundId, code, v });
  }
  const previous = new Map<string, bigint>();
  for (const r of (await fundStoredOpening(tx, tenantId, general, p.next)).filter((x) => x.source === "fy_close")) {
    const k = `${r.fundId}|${r.accountCode}`; previous.set(k, (previous.get(k) ?? 0n) + r.signed);
  }
  const changed = previous.size !== wanted.length || wanted.some((w) => previous.get(`${w.fundId}|${w.code}`) !== w.v);
  if (changed) {
    await tx.execute(sql`DELETE FROM gl.finance_opening_balances WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${p.next} AND source = 'fy_close'`);
    for (const w of wanted) {
      const { debitMinor, creditMinor } = toDrCr(w.v);
      // routed through the seam: the opening-balance row's fund_id comes from fx.tagOpeningBalance (the fund it belongs to)
      const row = fx.tagOpeningBalance({}, w.fundId) as { fundId: string };
      await tx.execute(sql`
        INSERT INTO gl.finance_opening_balances (tenant_id, fy_code, account_code, fund_id, debit_minor, credit_minor, narration, entered_by, source)
        VALUES (${tenantId}::uuid, ${p.next}, ${w.code}, ${row.fundId}::uuid, ${debitMinor.toString()}::bigint, ${creditMinor.toString()}::bigint,
                ${`Brought forward from ${p.fy} (per-fund year-end close)`}, ${meta.actorId}::uuid, 'fy_close')
      `);
    }
  }
  const fundCarried = [...carried.values()].reduce((s, m) => s + (m.get(ACCUMULATED_FUND) ?? 0n), 0n);
  return { openingBalanceCount: wanted.length, changed, fundCarriedMinor: fundCarried };
}
