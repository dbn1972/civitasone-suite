import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * fx-p3: the 31 March lapse statement (finance-service GET /v1/finance/budgets/lapse-statement?fy=YYYY-YY).
 * GFR: unspent provision lapses at the end of the financial year and is not carried forward. Until the year-end
 * close records it (`recorded`), the statement is provisional. All money is paise as decimal strings.
 */
export type LapseRow = {
  headId: string;
  headCode: string;
  headName: string;
  beMinor: string;
  reMinor: string;
  reappropriationNetMinor: string;
  expenditureMinor: string;
  lapseMinor: string;
  excessMinor: string;
};
export type LapseTotals = { beMinor: string; reMinor: string; expenditureMinor: string; lapseMinor: string; excessMinor: string };
export type LapseStatement = {
  fiscalYear: string;
  recorded: { recordedAt: string; recordedBy: string; recordedByName?: string | null } | null;
  rows: LapseRow[];
  totals: LapseTotals;
};

const MINOR_RE = /^-?\d+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
/** Paise string, or "0" for a missing/garbled value (never a float). */
const minor = (v: unknown): string =>
  typeof v === "string" && MINOR_RE.test(v.trim()) ? v.trim() : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "0";
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Sum of a paise column (BigInt end to end), used when the server sent no totals. */
function sumOf(rows: LapseRow[], key: keyof LapseTotals): string {
  return rows.reduce((s, r) => s + BigInt(r[key]), 0n).toString();
}

export function mapLapseStatement(payload: unknown): LapseStatement | null {
  if (!isObj(payload) || typeof payload.fiscalYear !== "string" || !Array.isArray(payload.rows)) return null;
  const rows: LapseRow[] = payload.rows.filter(isObj).map((r) => ({
    headId: str(r.headId),
    headCode: str(r.headCode),
    headName: str(r.headName),
    beMinor: minor(r.beMinor),
    reMinor: minor(r.reMinor),
    reappropriationNetMinor: minor(r.reappropriationNetMinor),
    expenditureMinor: minor(r.expenditureMinor),
    lapseMinor: minor(r.lapseMinor),
    excessMinor: minor(r.excessMinor),
  }));
  const t = isObj(payload.totals) ? payload.totals : null;
  const total = (k: keyof LapseTotals) => (t && t[k] !== undefined ? minor(t[k]) : sumOf(rows, k));
  const rec = isObj(payload.recorded) && typeof payload.recorded.recordedAt === "string" ? payload.recorded : null;
  return {
    fiscalYear: payload.fiscalYear,
    recorded: rec
      ? { recordedAt: rec.recordedAt as string, recordedBy: str(rec.recordedBy), recordedByName: typeof rec.recordedByName === "string" ? rec.recordedByName : null }
      : null,
    rows,
    totals: { beMinor: total("beMinor"), reMinor: total("reMinor"), expenditureMinor: total("expenditureMinor"), lapseMinor: total("lapseMinor"), excessMinor: total("excessMinor") },
  };
}

export async function getLapseStatement(fy: string): Promise<LoaderResult<LapseStatement | null>> {
  return fetchJson<unknown, LapseStatement | null>(`/api/v1/finance/budgets/lapse-statement?fy=${encodeURIComponent(fy)}`, null, {
    revalidateSeconds: 0,
    telemetryKey: "finance.budgets.lapse-statement",
    mapResponse: mapLapseStatement,
  });
}
