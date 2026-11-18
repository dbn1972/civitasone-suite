/**
 * PSU v1 slice C: pluggable statutory configuration for the PSU finance disclosures. EVERY value here is CA / company-secretary
 * VERIFY: placeholders from secondary sources, held in ONE place so a CA can change them (code default, or a JSON override in
 * FINANCE_PSU_DISCLOSURE_CONFIG merged over the defaults) without touching the builders. Money is paise (bigint). Nothing here is
 * read from edition / profile; the disclosures are gated on STORED settings (coa_template = commercial AND govt_owned / audit_profile).
 */

/** Chart heads the dividend flow posts to. Seeded lazily and collision-guarded (heads.ts); never part of the shared commercial seed. */
export const PSU_DIVIDEND_APPROPRIATION_CODE = "3220"; // equity / reserve: appropriation of profits to dividends (its DEBITS are SOCIE dividends)
export const PSU_DIVIDEND_PAYABLE_CODE = "2650";       // liability / dividend_payable
export const PSU_BANK_CODE = "1100";                   // the cash-and-bank head the commercial statements already treat as cash

/** Holder categories counted as Government shareholding. CA-VERIFY. */
export const GOVT_HOLDER_CATEGORIES: readonly string[] = ["president_of_india", "other_govt", "govt_body"];

const CRORE_PAISE = 10_000_000n * 100n;

export interface CaroClauseStub { clause: string; title: string }

export interface PsuDisclosureConfig {
  /** DIPAM minimum-dividend rule. mode "off" (default) computes nothing; "advisory" returns the figures on a declaration and never blocks. CA-VERIFY. */
  dipam: { mode: "off" | "advisory"; patBps: number; netWorthBps: number };
  /** Companies Act s.135: 2% of the average net profit of the 3 preceding FYs, applicable when any threshold of the immediately preceding FY is met. CA-VERIFY. */
  csr: { rateBps: number; lookbackYears: number; netWorthMinor: bigint; turnoverMinor: bigint; netProfitMinor: bigint };
  /** Government ownership at/above this (bps) is the Companies Act s.2(45) Government-company test. CA-VERIFY. Advisory warning only. */
  govtCompanyMinBps: number;
  caro: { title: string; clauses: CaroClauseStub[]; note: string };
  cag: { title: string; notes: Array<{ ref: string; text: string }> };
}

const CARO_CLAUSES: CaroClauseStub[] = [
  ["3(i)", "Property, plant and equipment and intangible assets"], ["3(ii)", "Inventory and working-capital limits"],
  ["3(iii)", "Investments, guarantees, security, loans and advances"], ["3(iv)", "Loans to directors and investments (ss.185, 186)"],
  ["3(v)", "Deposits accepted"], ["3(vi)", "Cost records (s.148)"], ["3(vii)", "Statutory dues"], ["3(viii)", "Unrecorded income surrendered"],
  ["3(ix)", "Default in repayment of borrowings"], ["3(x)", "Money raised by public offer / preferential allotment"], ["3(xi)", "Fraud"],
  ["3(xii)", "Nidhi company"], ["3(xiii)", "Related-party transactions (ss.177, 188)"], ["3(xiv)", "Internal audit system"],
  ["3(xv)", "Non-cash transactions with directors"], ["3(xvi)", "Registration under RBI Act s.45-IA"], ["3(xvii)", "Cash losses"],
  ["3(xviii)", "Resignation of statutory auditors"], ["3(xix)", "Material uncertainty on meeting liabilities"], ["3(xx)", "CSR (s.135) unspent amount"],
  ["3(xxi)", "Qualifications in group companies' CARO reports"],
].map(([clause, title]) => ({ clause: clause!, title: title! }));

export const DEFAULT_PSU_CONFIG: PsuDisclosureConfig = {
  dipam: { mode: "off", patBps: 3000, netWorthBps: 500 },
  csr: { rateBps: 200, lookbackYears: 3, netWorthMinor: 500n * CRORE_PAISE, turnoverMinor: 1000n * CRORE_PAISE, netProfitMinor: 5n * CRORE_PAISE },
  govtCompanyMinBps: 5100,
  caro: {
    title: "Companies (Auditor's Report) Order, 2020 - clause-wise disclosure stubs",
    clauses: CARO_CLAUSES,
    note: "Placeholder. The statutory auditor owns the CARO 2020 report; this platform captures no audit conclusions. CA-VERIFY the clause set and the applicability of each clause.",
  },
  cag: {
    title: "Comptroller and Auditor General of India (C&AG) audit disclosures",
    notes: [
      { ref: "s.139(5)", text: "Placeholder. The statutory auditor of a Government company is appointed by the C&AG. CA/CS-VERIFY wording." },
      { ref: "s.143(5)", text: "Placeholder. The auditor reports on the directions issued by the C&AG. CA/CS-VERIFY wording." },
      { ref: "s.143(6)(a)", text: "Placeholder. Supplementary audit by the C&AG; comments are to be placed before the annual general meeting. CA/CS-VERIFY wording." },
    ],
  },
};

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const big = (v: unknown, d: bigint): bigint => { try { return typeof v === "string" || typeof v === "number" ? BigInt(v) : d; } catch { return d; } };

/** The effective config: DEFAULT_PSU_CONFIG with the dipam mode from FINANCE_PSU_DIPAM_MODE and an optional JSON override. */
export function loadPsuConfig(env: NodeJS.ProcessEnv = process.env): PsuDisclosureConfig {
  const d = DEFAULT_PSU_CONFIG;
  let o: Record<string, any> = {};
  try { if (env.FINANCE_PSU_DISCLOSURE_CONFIG?.trim()) o = JSON.parse(env.FINANCE_PSU_DISCLOSURE_CONFIG) as Record<string, any>; } catch { o = {}; }
  const modeRaw = (env.FINANCE_PSU_DIPAM_MODE ?? o.dipam?.mode ?? d.dipam.mode) as string;
  return {
    dipam: { mode: modeRaw === "advisory" ? "advisory" : "off", patBps: num(o.dipam?.patBps, d.dipam.patBps), netWorthBps: num(o.dipam?.netWorthBps, d.dipam.netWorthBps) },
    csr: {
      rateBps: num(o.csr?.rateBps, d.csr.rateBps), lookbackYears: Math.max(1, Math.min(5, num(o.csr?.lookbackYears, d.csr.lookbackYears))),
      netWorthMinor: big(o.csr?.netWorthMinor, d.csr.netWorthMinor), turnoverMinor: big(o.csr?.turnoverMinor, d.csr.turnoverMinor), netProfitMinor: big(o.csr?.netProfitMinor, d.csr.netProfitMinor),
    },
    govtCompanyMinBps: num(o.govtCompanyMinBps, d.govtCompanyMinBps),
    caro: { title: o.caro?.title ?? d.caro.title, clauses: Array.isArray(o.caro?.clauses) ? o.caro.clauses : d.caro.clauses, note: o.caro?.note ?? d.caro.note },
    cag: { title: o.cag?.title ?? d.cag.title, notes: Array.isArray(o.cag?.notes) ? o.cag.notes : d.cag.notes },
  };
}
