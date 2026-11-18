/**
 * PSU v1 slice C: PURE builders (no DB, no clock) for the PSU finance disclosures: cap table, dividend arithmetic, the DIPAM advisory,
 * the CSR (s.135) obligation note and the CARO / C&AG note stubs. All statutory parameters come from config.ts (CA-VERIFY).
 * Money is paise (bigint); shares are bigint; percentages are basis points (integer, floor) and a 2-decimal string.
 */
import { GOVT_HOLDER_CATEGORIES, type PsuDisclosureConfig } from "./config.js";

export type HoldingInput = { id?: string; holderName: string; category: string; shareClass: string; shares: bigint; faceValueMinor: bigint; folio?: string | null; status: string };

const pct = (bps: bigint): string => `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}`;
const ratioBps = (part: bigint, whole: bigint): bigint => (whole > 0n ? (part * 10_000n) / whole : 0n);

export type CapTableClass = {
  shares: string; paidUpMinor: string;
  byCategory: Array<{ category: string; shares: string; paidUpMinor: string; holdingBps: number; holdingPct: string }>;
  holders: Array<{ id?: string; holderName: string; category: string; folio: string | null; shares: string; paidUpMinor: string; holdingBps: number; holdingPct: string }>;
};
export type CapTable = {
  equity: CapTableClass; preference: CapTableClass;
  govtEquityShares: string; govtOwnershipBps: number; govtOwnershipPct: string;
  /** paid-up of all active holdings (equity + preference) vs the share-capital ledger balance. null when no ledger figure was supplied. */
  paidUpTotalMinor: string; shareCapitalLedgerMinor: string | null; tiesToShareCapital: boolean | null; differenceMinor: string | null;
  warnings: string[];
};

function classOf(rows: HoldingInput[]): CapTableClass {
  const total = rows.reduce((a, r) => a + r.shares, 0n);
  const paid = (r: HoldingInput): bigint => r.shares * r.faceValueMinor;
  const cats = new Map<string, { shares: bigint; paid: bigint }>();
  for (const r of rows) { const c = cats.get(r.category) ?? { shares: 0n, paid: 0n }; c.shares += r.shares; c.paid += paid(r); cats.set(r.category, c); }
  return {
    shares: total.toString(), paidUpMinor: rows.reduce((a, r) => a + paid(r), 0n).toString(),
    byCategory: [...cats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, c]) => {
      const b = ratioBps(c.shares, total);
      return { category, shares: c.shares.toString(), paidUpMinor: c.paid.toString(), holdingBps: Number(b), holdingPct: pct(b) };
    }),
    holders: rows.map((r) => { const b = ratioBps(r.shares, total); return { ...(r.id ? { id: r.id } : {}), holderName: r.holderName, category: r.category, folio: r.folio ?? null, shares: r.shares.toString(), paidUpMinor: paid(r).toString(), holdingBps: Number(b), holdingPct: pct(b) }; }),
  };
}

/** The share-capital structure from the ACTIVE holdings, the Government ownership %, and the tie to the share-capital ledger balance. */
export function buildCapTable(all: HoldingInput[], shareCapitalLedgerMinor: bigint | null, cfg: PsuDisclosureConfig, govtOwnedFlag: boolean): CapTable {
  const active = all.filter((r) => r.status === "active");
  const equity = active.filter((r) => r.shareClass === "equity"), preference = active.filter((r) => r.shareClass === "preference");
  const eqTotal = equity.reduce((a, r) => a + r.shares, 0n);
  const govt = equity.filter((r) => GOVT_HOLDER_CATEGORIES.includes(r.category)).reduce((a, r) => a + r.shares, 0n);
  const govtBps = ratioBps(govt, eqTotal);
  const paidUp = active.reduce((a, r) => a + r.shares * r.faceValueMinor, 0n);
  const warnings: string[] = [];
  if (active.length === 0) warnings.push("CAP_TABLE_EMPTY: no active shareholding is recorded");
  if (govtOwnedFlag && eqTotal > 0n && govtBps < BigInt(cfg.govtCompanyMinBps)) {
    warnings.push(`GOVT_HOLDING_BELOW_THRESHOLD: Government holds ${pct(govtBps)}% of the equity shares, below the ${pct(BigInt(cfg.govtCompanyMinBps))}% Government-company test (CA/CS-VERIFY) while govt_owned is set`);
  }
  const tie = shareCapitalLedgerMinor === null ? null : shareCapitalLedgerMinor === paidUp;
  if (tie === false) warnings.push(`SHARE_CAPITAL_MISMATCH: register paid-up ${paidUp} paise vs share-capital ledger ${shareCapitalLedgerMinor} paise`);
  return {
    equity: classOf(equity), preference: classOf(preference),
    govtEquityShares: govt.toString(), govtOwnershipBps: Number(govtBps), govtOwnershipPct: pct(govtBps),
    paidUpTotalMinor: paidUp.toString(), shareCapitalLedgerMinor: shareCapitalLedgerMinor === null ? null : shareCapitalLedgerMinor.toString(), tiesToShareCapital: tie,
    differenceMinor: shareCapitalLedgerMinor === null ? null : (shareCapitalLedgerMinor - paidUp).toString(), warnings,
  };
}

/** Dividend = per-share rate x equity shares. The Government's portion is its equity shares x the same rate. */
export function computeDividend(holdings: HoldingInput[], perShareMinor: bigint): { equityShares: bigint; govtShares: bigint; amountMinor: bigint; govtAmountMinor: bigint } {
  const eq = holdings.filter((r) => r.status === "active" && r.shareClass === "equity");
  const equityShares = eq.reduce((a, r) => a + r.shares, 0n);
  const govtShares = eq.filter((r) => GOVT_HOLDER_CATEGORIES.includes(r.category)).reduce((a, r) => a + r.shares, 0n);
  return { equityShares, govtShares, amountMinor: equityShares * perShareMinor, govtAmountMinor: govtShares * perShareMinor };
}

export type DipamAdvisory = {
  mode: "advisory"; patMinor: string; netWorthMinor: string; byPatMinor: string; byNetWorthMinor: string; requiredMinor: string;
  declaredForFyMinor: string; met: boolean; caVerify: string;
};
/** DIPAM minimum dividend: the HIGHER of x% of PAT and y% of net worth (CA-VERIFY). Advisory only: never blocks a declaration. */
export function dipamAdvisory(patMinor: bigint, netWorthMinor: bigint, declaredForFyMinor: bigint, cfg: PsuDisclosureConfig): DipamAdvisory | null {
  if (cfg.dipam.mode !== "advisory") return null;
  const byPat = patMinor > 0n ? (patMinor * BigInt(cfg.dipam.patBps)) / 10_000n : 0n;
  const byNw = netWorthMinor > 0n ? (netWorthMinor * BigInt(cfg.dipam.netWorthBps)) / 10_000n : 0n;
  const required = byPat > byNw ? byPat : byNw;
  return {
    mode: "advisory", patMinor: patMinor.toString(), netWorthMinor: netWorthMinor.toString(), byPatMinor: byPat.toString(), byNetWorthMinor: byNw.toString(),
    requiredMinor: required.toString(), declaredForFyMinor: declaredForFyMinor.toString(), met: declaredForFyMinor >= required,
    caVerify: `Higher of ${cfg.dipam.patBps / 100}% of PAT and ${cfg.dipam.netWorthBps / 100}% of net worth (DIPAM capital-restructuring policy); the percentages are config and CA-VERIFY. Advisory: a declaration is never blocked.`,
  };
}

export type YearFigures = { fy: string; hasActivity: boolean; profitBeforeTaxMinor: bigint; turnoverMinor: bigint; netWorthMinor: bigint };
export type CsrNote = {
  applicable: boolean; fiscalYear: string; rateBps: number; yearsUsed: string[]; averageNetProfitMinor: string; obligationMinor: string;
  applicabilityBasis: { priorFy: string; netWorthMinor: string; turnoverMinor: string; netProfitMinor: string; thresholds: { netWorthMinor: string; turnoverMinor: string; netProfitMinor: string }; metBy: string[] };
  caVerify: string[];
};
/**
 * Companies Act s.135 CSR obligation note. `prior` = the immediately preceding FY (drives applicability); `lookback` = up to N
 * preceding FYs, newest first (drives the average). Net profit is proxied by profit BEFORE tax from the books -- the s.198
 * computation is CA-VERIFY. Years with no ledger activity are excluded from the average. Negative/zero average => obligation 0.
 */
export function csrNote(fy: string, prior: YearFigures, lookback: YearFigures[], cfg: PsuDisclosureConfig): CsrNote {
  const t = cfg.csr;
  const metBy: string[] = [];
  if (prior.hasActivity) {
    if (prior.netWorthMinor >= t.netWorthMinor) metBy.push("net_worth");
    if (prior.turnoverMinor >= t.turnoverMinor) metBy.push("turnover");
    if (prior.profitBeforeTaxMinor >= t.netProfitMinor) metBy.push("net_profit");
  }
  const used = lookback.slice(0, t.lookbackYears).filter((y) => y.hasActivity);
  const avg = used.length > 0 ? used.reduce((a, y) => a + y.profitBeforeTaxMinor, 0n) / BigInt(used.length) : 0n;
  const applicable = metBy.length > 0;
  const obligation = applicable && avg > 0n ? (avg * BigInt(t.rateBps)) / 10_000n : 0n;
  return {
    applicable, fiscalYear: fy, rateBps: t.rateBps, yearsUsed: used.map((y) => y.fy), averageNetProfitMinor: avg.toString(), obligationMinor: obligation.toString(),
    applicabilityBasis: {
      priorFy: prior.fy, netWorthMinor: prior.netWorthMinor.toString(), turnoverMinor: prior.turnoverMinor.toString(), netProfitMinor: prior.profitBeforeTaxMinor.toString(),
      thresholds: { netWorthMinor: t.netWorthMinor.toString(), turnoverMinor: t.turnoverMinor.toString(), netProfitMinor: t.netProfitMinor.toString() }, metBy,
    },
    caVerify: [
      `Obligation = ${t.rateBps / 100}% of the average net profit of up to ${t.lookbackYears} preceding financial years (s.135(5)); net profit is proxied by profit before tax from the books, the s.198 computation is CA-VERIFY`,
      "Applicability thresholds (net worth / turnover / net profit of the immediately preceding FY) are config and CA-VERIFY; turnover is proxied by total revenue",
      "Sch VII eligible spend, unspent-amount transfer and the CSR committee are not built",
    ],
  };
}

export type AuditMarkers = {
  auditProfile: string;
  caro: { title: string; applicable: true; clauses: Array<{ clause: string; title: string; status: "to_be_reported_by_auditor" }>; note: string };
  cag: { title: string; applicable: true; notes: Array<{ ref: string; text: string }> };
};
/** CARO 2020 clause stubs + C&AG supplementary-audit note stubs. Only for audit_profile = cag_caro; carries no audit logic. */
export function auditMarkers(auditProfile: string, cfg: PsuDisclosureConfig): AuditMarkers | null {
  if (auditProfile !== "cag_caro") return null;
  return {
    auditProfile,
    caro: { title: cfg.caro.title, applicable: true, clauses: cfg.caro.clauses.map((c) => ({ ...c, status: "to_be_reported_by_auditor" as const })), note: cfg.caro.note },
    cag: { title: cfg.cag.title, applicable: true, notes: cfg.cag.notes },
  };
}
