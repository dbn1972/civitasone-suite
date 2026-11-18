/**
 * PSU v1 slice C services (all in the caller's tenant-scoped transaction, RLS on every table):
 *  - the shareholding / cap-table register,
 *  - the dividend flow:  declare  Dr 3220 dividends-declared (equity/reserve appropriation) / Cr 2650 dividend payable
 *                        pay      Dr 2650 dividend payable / Cr 1100 bank
 *    posted through the EXISTING outbox -> finance.gl.post path (enqueueSpineJournal), deterministic journal ids,
 *  - the statement-attached disclosures (cap table, CARO / C&AG stubs, CSR note).
 * Reached only through routes.ts behind the centralised gate (gate.ts). Nothing here reads edition / profile.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { DomainError } from "../approvals/domain.js";
import { auditEvent, type ActorMeta } from "../approvals/apply.js";
import { financeHeads } from "../budget/schema.js";
import { assertCommercialChartReadyTx } from "../gl/commercial-chart.js";
import { fyClosedReasonTx, fyClosedMessage } from "../gl/fy-guard.js";
import { periodPostingRefusal } from "../gl/posting-rules.js";
import { deterministicId, enqueueSpineJournal } from "../gl/spine.js";
import { findTemplateCollisions, type StandardGlHead } from "../gl/standard-heads.js";
import { fyFromDate } from "../hoa/voucher.js";
import { getPeriodStatusTx } from "../period-close/repo.js";
import { previousFy } from "../../shared/ist-date.js";
import { classify, changesInEquity, scheduleIIIProfitAndLoss, type CommercialRow, type PresentationConfig } from "../financial-statements/commercial-statements.js";
import { commercialPresentation, loadCommercialRows, loadRowsForFy } from "../financial-statements/commercial-statements-repo.js";
import {
  loadPsuConfig, PSU_BANK_CODE, PSU_DIVIDEND_APPROPRIATION_CODE, PSU_DIVIDEND_PAYABLE_CODE, type PsuDisclosureConfig,
} from "./config.js";
import { auditMarkers, buildCapTable, computeDividend, csrNote, dipamAdvisory, type YearFigures } from "./domain.js";
import { psuDividends, psuShareholdings, type DividendRow, type DividendType, type HolderCategory, type ShareClass, type ShareholdingRow } from "./schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? [])) as Row[];

// ---- the two chart heads the dividend flow needs (lazy, collision-guarded) --------------------------------------------------------

export const PSU_HEADS: StandardGlHead[] = [
  { code: PSU_DIVIDEND_PAYABLE_CODE, name: "Dividend Payable", classification: "liability", statementClass: "dividend_payable" },
  { code: PSU_DIVIDEND_APPROPRIATION_CODE, name: "Dividends Declared (Appropriation of Profits)", classification: "equity", statementClass: "reserve" },
];

/**
 * Seeds the dividend-payable and dividends-declared heads if absent. ADD-ONLY and idempotent (ON CONFLICT DO NOTHING). A tenant that
 * already uses either code for a different classification is refused (PSU_HEAD_COLLISION), never silently posted against: the same
 * guard the commercial seed applies. Deliberately NOT part of the shared commercial seed, so a non-PSU commercial chart is unchanged.
 */
export async function ensurePsuHeadsTx(tx: Tx, tenantId: string, actorId: string): Promise<void> {
  const existing = await tx.select({ code: financeHeads.code, classification: financeHeads.classification }).from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), sql`${financeHeads.code} IN (${sql.join(PSU_HEADS.map((h) => sql`${h.code}`), sql`, `)})`));
  const collisions = findTemplateCollisions(existing, PSU_HEADS);
  if (collisions.length > 0) {
    throw new DomainError("PSU_HEAD_COLLISION", `these chart codes are already used for another purpose: ${collisions.map((c) => `${c.code} (existing ${c.existing ?? "none"}, needed ${c.template})`).join(", ")}`);
  }
  await tx.insert(financeHeads).values(PSU_HEADS.map((h) => ({
    tenantId, code: h.code, name: h.name, level: 0, classification: h.classification, hoaCode: null, isControl: false,
    statementClass: h.statementClass, createdBy: actorId, updatedBy: actorId,
  }))).onConflictDoNothing({ target: [financeHeads.tenantId, financeHeads.code] });
}

// ---- shareholding register --------------------------------------------------------------------------------------------------------

export type HoldingBody = {
  holderName: string; category: HolderCategory; shareClass?: ShareClass | undefined; shares: bigint; faceValueMinor: bigint; folio?: string | undefined; remarks?: string | undefined; status?: "active" | "retired" | undefined;
};
export type HoldingPatch = { [K in keyof HoldingBody]?: HoldingBody[K] | undefined } & { expectedVersion?: number | undefined };

export async function createHoldingTx(tx: Tx, meta: ActorMeta, b: HoldingBody): Promise<ShareholdingRow> {
  if (b.folio) await assertFolioFreeTx(tx, meta.tenantId, b.shareClass ?? "equity", b.folio, null);
  const [row] = await tx.insert(psuShareholdings).values({
    tenantId: meta.tenantId, holderName: b.holderName, category: b.category, shareClass: b.shareClass ?? "equity", shares: b.shares, faceValueMinor: b.faceValueMinor,
    folio: b.folio ?? null, remarks: b.remarks ?? null, status: b.status ?? "active", createdBy: meta.actorId, updatedBy: meta.actorId,
  }).returning();
  await auditEvent(tx, meta, "create_psu_shareholding", "psu_shareholding", row.id, { holderName: b.holderName, category: b.category, shares: b.shares.toString() });
  return row;
}

async function assertFolioFreeTx(tx: Tx, tenantId: string, shareClass: string, folio: string, exceptId: string | null): Promise<void> {
  const hit = rowsOf(await tx.execute(sql`SELECT id FROM gl.psu_shareholdings WHERE tenant_id = ${tenantId}::uuid AND share_class = ${shareClass} AND folio = ${folio} LIMIT 1`))[0];
  if (hit && String(hit.id) !== exceptId) throw new DomainError("FOLIO_EXISTS", `folio ${folio} is already used for ${shareClass} shares`);
}

export async function updateHoldingTx(tx: Tx, meta: ActorMeta, id: string, p: HoldingPatch): Promise<ShareholdingRow> {
  const [cur]: ShareholdingRow[] = await tx.select().from(psuShareholdings).where(and(eq(psuShareholdings.tenantId, meta.tenantId), eq(psuShareholdings.id, id))).for("update").limit(1);
  if (!cur) throw new DomainError("HOLDING_NOT_FOUND", `shareholding ${id} does not exist`);
  if (p.expectedVersion !== undefined && p.expectedVersion !== cur.version) throw new DomainError("HOLDING_VERSION_CONFLICT", `shareholding ${id} is at version ${cur.version}, not ${p.expectedVersion}`);
  const shareClass = p.shareClass ?? cur.shareClass;
  const folio = p.folio !== undefined ? p.folio : cur.folio;
  if (folio) await assertFolioFreeTx(tx, meta.tenantId, shareClass, folio, id);
  const [row] = await tx.update(psuShareholdings).set({
    holderName: p.holderName ?? cur.holderName, category: p.category ?? cur.category, shareClass, shares: p.shares ?? cur.shares, faceValueMinor: p.faceValueMinor ?? cur.faceValueMinor,
    folio: folio ?? null, remarks: p.remarks !== undefined ? p.remarks : cur.remarks, status: p.status ?? cur.status,
    updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${psuShareholdings.version} + 1`,
  }).where(and(eq(psuShareholdings.tenantId, meta.tenantId), eq(psuShareholdings.id, id))).returning();
  await auditEvent(tx, meta, "update_psu_shareholding", "psu_shareholding", id, { shares: row.shares.toString(), status: row.status });
  return row;
}

export const listHoldingsTx = (tx: Tx, tenantId: string): Promise<ShareholdingRow[]> =>
  tx.select().from(psuShareholdings).where(eq(psuShareholdings.tenantId, tenantId)).orderBy(asc(psuShareholdings.shareClass), asc(psuShareholdings.holderName));

/** Paid-up share capital as the Balance Sheet prints it: stored class `equity` other than the accumulated fund (same split as SOCIE / BS). */
export function shareCapitalLedgerMinor(rows: ReadonlyArray<CommercialRow>, cfg: PresentationConfig): bigint {
  return classify(rows).filter((c) => c.statementClass === "equity" && c.code !== cfg.accumulatedFund).reduce((a, c) => a + c.natural, 0n);
}

// ---- dividends --------------------------------------------------------------------------------------------------------------------

async function assertPostingAllowedTx(tx: Tx, tenantId: string, postingDate: string): Promise<void> {
  await assertCommercialChartReadyTx(tx, tenantId);
  const period = postingDate.slice(0, 7);
  const refusal = periodPostingRefusal(await getPeriodStatusTx(tx, tenantId, period), "journal", period);
  if (refusal) throw new DomainError(refusal.code, refusal.message);
  const fyCode = fyFromDate(postingDate);
  const fy = rowsOf(await tx.execute(sql`SELECT status FROM gl.finance_fiscal_years WHERE tenant_id = ${tenantId}::uuid AND code = ${fyCode} LIMIT 1`))[0];
  if (fy?.status === "draft") throw new DomainError("FY_NOT_ACTIVE", `financial year ${fyCode} has not been activated; postings dated ${postingDate} cannot be accepted until it is`);
  const closed = await fyClosedReasonTx(tx, tenantId, fyCode);
  if (closed) throw new DomainError("FY_CLOSED", fyClosedMessage(closed, postingDate));
}

export type DeclareBody = { dividendType: DividendType; declaredOn: string; resolutionRef: string; perShareMinor: bigint };

export async function declareDividendTx(tx: Tx, meta: ActorMeta, b: DeclareBody, cfg: PsuDisclosureConfig = loadPsuConfig()): Promise<{ dividend: DividendRow; dipamAdvisory: ReturnType<typeof dipamAdvisory> }> {
  await assertPostingAllowedTx(tx, meta.tenantId, b.declaredOn);
  const fy = fyFromDate(b.declaredOn);
  const dup = rowsOf(await tx.execute(sql`SELECT id FROM gl.psu_dividends WHERE tenant_id = ${meta.tenantId}::uuid AND fy_code = ${fy} AND dividend_type = ${b.dividendType} AND declared_on = ${b.declaredOn}::date LIMIT 1`))[0];
  if (dup) throw new DomainError("DIVIDEND_EXISTS", `a ${b.dividendType} dividend declared on ${b.declaredOn} already exists for ${fy}`);
  const holdings: ShareholdingRow[] = await listHoldingsTx(tx, meta.tenantId);
  const d = computeDividend(holdings, b.perShareMinor);
  if (d.equityShares <= 0n) throw new DomainError("NO_EQUITY_SHARES", "the shareholding register has no active equity shares; record the cap table before declaring a dividend");
  await ensurePsuHeadsTx(tx, meta.tenantId, meta.actorId);
  const id = randomUUID();
  const journalId = deterministicId(`psu_dividend_declare:${id}`);
  const [row]: DividendRow[] = await tx.insert(psuDividends).values({
    id, tenantId: meta.tenantId, fyCode: fy, dividendType: b.dividendType, declaredOn: b.declaredOn, resolutionRef: b.resolutionRef, perShareMinor: b.perShareMinor,
    equityShares: d.equityShares, govtShares: d.govtShares, amountMinor: d.amountMinor, govtAmountMinor: d.govtAmountMinor, status: "declared",
    declaredJournalId: journalId, createdBy: meta.actorId, updatedBy: meta.actorId,
  }).returning();
  const narration = `${b.dividendType} dividend ${fy} (${b.resolutionRef})`;
  await enqueueSpineJournal(tx, {
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId, sourceKey: `psu_dividend_declare:${id}`, type: "journal", postingDate: b.declaredOn,
    lines: [
      { accountCode: PSU_DIVIDEND_APPROPRIATION_CODE, debitMinor: d.amountMinor, creditMinor: 0n, narration },
      { accountCode: PSU_DIVIDEND_PAYABLE_CODE, debitMinor: 0n, creditMinor: d.amountMinor, narration },
    ],
  });
  await auditEvent(tx, meta, "declare_psu_dividend", "psu_dividend", id, { fy, amountMinor: d.amountMinor.toString(), govtAmountMinor: d.govtAmountMinor.toString(), resolutionRef: b.resolutionRef, journalId });
  let advisory: ReturnType<typeof dipamAdvisory> = null;
  if (cfg.dipam.mode === "advisory") advisory = await dipamForFyTx(tx, meta.tenantId, fy, cfg);
  return { dividend: row!, dipamAdvisory: advisory };
}

/** DIPAM advisory for a FY from the books (PAT, net worth) and the dividends declared so far in the FY. */
export async function dipamForFyTx(tx: Tx, tenantId: string, fy: string, cfg: PsuDisclosureConfig): Promise<ReturnType<typeof dipamAdvisory>> {
  const rows = await loadCommercialRows(tx, tenantId, fy);
  const cs = classify(rows);
  const pres = commercialPresentation();
  const pat = BigInt(scheduleIIIProfitAndLoss(cs, pres).profitAfterTaxMinor);
  const nw = BigInt(changesInEquity(cs, pres).balanceSheetEquityMinor);
  const declared = rowsOf(await tx.execute(sql`SELECT COALESCE(SUM(amount_minor), 0)::text AS s FROM gl.psu_dividends WHERE tenant_id = ${tenantId}::uuid AND fy_code = ${fy}`))[0];
  return dipamAdvisory(pat, nw, BigInt(String(declared?.s ?? "0")), cfg);
}

export async function payDividendTx(tx: Tx, meta: ActorMeta, id: string, paidOn: string): Promise<DividendRow> {
  const [cur]: DividendRow[] = await tx.select().from(psuDividends).where(and(eq(psuDividends.tenantId, meta.tenantId), eq(psuDividends.id, id))).for("update").limit(1);
  if (!cur) throw new DomainError("DIVIDEND_NOT_FOUND", `dividend ${id} does not exist`);
  if (cur.status !== "declared") throw new DomainError("DIVIDEND_ALREADY_PAID", `dividend ${id} is already paid`);
  if (paidOn < String(cur.declaredOn)) throw new DomainError("DIVIDEND_PAID_BEFORE_DECLARED", `payment date ${paidOn} is before the declaration date ${cur.declaredOn}`);
  await assertPostingAllowedTx(tx, meta.tenantId, paidOn);
  const journalId = deterministicId(`psu_dividend_pay:${id}`);
  const [row]: DividendRow[] = await tx.update(psuDividends).set({
    status: "paid", paidOn, paidJournalId: journalId, updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${psuDividends.version} + 1`,
  }).where(and(eq(psuDividends.tenantId, meta.tenantId), eq(psuDividends.id, id))).returning();
  const narration = `${cur.dividendType} dividend ${cur.fyCode} paid (${cur.resolutionRef})`;
  await enqueueSpineJournal(tx, {
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId, sourceKey: `psu_dividend_pay:${id}`, type: "journal", postingDate: paidOn,
    lines: [
      { accountCode: PSU_DIVIDEND_PAYABLE_CODE, debitMinor: cur.amountMinor, creditMinor: 0n, narration },
      { accountCode: PSU_BANK_CODE, debitMinor: 0n, creditMinor: cur.amountMinor, narration },
    ],
  });
  await auditEvent(tx, meta, "pay_psu_dividend", "psu_dividend", id, { amountMinor: cur.amountMinor.toString(), paidOn, journalId });
  return row!;
}

export const listDividendsTx = (tx: Tx, tenantId: string, fy?: string): Promise<DividendRow[]> =>
  tx.select().from(psuDividends).where(fy ? and(eq(psuDividends.tenantId, tenantId), eq(psuDividends.fyCode, fy)) : eq(psuDividends.tenantId, tenantId)).orderBy(asc(psuDividends.declaredOn));

// ---- disclosures attached to the commercial statements ----------------------------------------------------------------------------

const hasActivity = (rows: ReadonlyArray<CommercialRow>): boolean => rows.some((r) => r.debitMinor !== 0n || r.creditMinor !== 0n);

function yearFigures(fy: string, rows: ReadonlyArray<CommercialRow>, pres: PresentationConfig): YearFigures {
  const cs = classify(rows);
  const pl = scheduleIIIProfitAndLoss(cs, pres);
  return { fy, hasActivity: hasActivity(rows), profitBeforeTaxMinor: BigInt(pl.profitBeforeTaxMinor), turnoverMinor: BigInt(pl.totalRevenueMinor), netWorthMinor: BigInt(changesInEquity(cs, pres).balanceSheetEquityMinor) };
}

export async function capTableTx(tx: Tx, tenantId: string, rows: ReadonlyArray<CommercialRow> | null, pres: PresentationConfig, govtOwned: boolean, cfg: PsuDisclosureConfig = loadPsuConfig()) {
  const holdings: ShareholdingRow[] = await listHoldingsTx(tx, tenantId);
  return buildCapTable(holdings.map((h) => ({ id: h.id, holderName: h.holderName, category: h.category, shareClass: h.shareClass, shares: h.shares, faceValueMinor: h.faceValueMinor, folio: h.folio, status: h.status })),
    rows ? shareCapitalLedgerMinor(rows, pres) : null, cfg, govtOwned);
}

export async function csrForFyTx(tx: Tx, tenantId: string, fy: string, pres: PresentationConfig, cfg: PsuDisclosureConfig = loadPsuConfig()) {
  const years: YearFigures[] = [];
  let y = fy;
  for (let i = 0; i < cfg.csr.lookbackYears; i++) { y = previousFy(y); years.push(yearFigures(y, await loadRowsForFy(tx, tenantId, y), pres)); }
  return csrNote(fy, years[0]!, years, cfg);
}

export type PsuDisclosures = {
  fiscalYear: string; auditProfile: string;
  capTable: Awaited<ReturnType<typeof capTableTx>>;
  dividends: Array<{ id: string; dividendType: string; declaredOn: string; status: string; amountMinor: string; govtAmountMinor: string; perShareMinor: string; paidOn: string | null }>;
  caro?: NonNullable<ReturnType<typeof auditMarkers>>["caro"]; cag?: NonNullable<ReturnType<typeof auditMarkers>>["cag"];
  csr?: ReturnType<typeof csrNote>;
  caVerify: string[];
};

/** The PSU-only disclosures for a commercial statement set. Called only for a tenant with stored govt_owned (commercial-routes gates it). */
export async function loadPsuDisclosuresTx(tx: Tx, tenantId: string, fy: string, o: { auditProfile: string; rows: ReadonlyArray<CommercialRow>; pres: PresentationConfig }): Promise<PsuDisclosures> {
  const cfg = loadPsuConfig();
  const [capTable, divs, csr] = [await capTableTx(tx, tenantId, o.rows, o.pres, true, cfg), await listDividendsTx(tx, tenantId, fy), await csrForFyTx(tx, tenantId, fy, o.pres, cfg)];
  const m = auditMarkers(o.auditProfile, cfg);
  return {
    fiscalYear: fy, auditProfile: o.auditProfile, capTable,
    dividends: divs.map((d) => ({ id: d.id, dividendType: d.dividendType, declaredOn: String(d.declaredOn), status: d.status, amountMinor: d.amountMinor.toString(), govtAmountMinor: d.govtAmountMinor.toString(), perShareMinor: d.perShareMinor.toString(), paidOn: d.paidOn ? String(d.paidOn) : null })),
    ...(m ? { caro: m.caro, cag: m.cag } : {}),
    ...(csr.applicable ? { csr } : {}),
    caVerify: [
      "Cap-table categories and the Government-company threshold are config (CA/CS-VERIFY)",
      "Dividend: DIPAM minimum-dividend rule is advisory/off by default; dividend TDS and Ind AS 10 (events after the reporting period) are not built",
      "CARO 2020 clause and C&AG note text are pluggable stubs; the auditor owns the report",
      "CSR note is shown only when an applicability threshold is met; spend tracking (Sch VII) is not built",
    ],
  };
}
