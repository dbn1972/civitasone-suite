import { formatMoney } from "@/lib/formatters";

/**
 * fx-p3: per-head opening / closing balances for one financial year
 * (finance-service GET /v1/finance/ledger/balances?headId=<uuid or code>&fy=YYYY-YY). Every figure is a signed
 * paise string, debit-positive. A head whose `carryForward` is false (revenue / expenditure) starts the year at
 * zero; balance-sheet, deposit, advance, suspense and Public Account heads carry their balance forward.
 */
export type LedgerBalancePeriod = { period: string; openingMinor: string; debitMinor: string; creditMinor: string; closingMinor: string };
export type LedgerBalances = {
  fiscalYear: string;
  head: { id: string; code: string; name: string; nature: string; carryForward: boolean };
  openingMinor: string;
  closingMinor: string;
  periods: LedgerBalancePeriod[];
};

const MINOR_RE = /^-?\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const minor = (v: unknown): string =>
  typeof v === "string" && MINOR_RE.test(v.trim()) ? v.trim() : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "0";
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A `?head=` value we may send on: a head UUID or a plain head code; anything else is ignored. */
export function parseHeadParam(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : Array.isArray(v) && typeof v[0] === "string" ? v[0].trim() : "";
  return s && (UUID_RE.test(s) || CODE_RE.test(s)) ? s : null;
}

export function mapLedgerBalances(payload: unknown): LedgerBalances | null {
  if (!isObj(payload) || typeof payload.fiscalYear !== "string" || !isObj(payload.head) || !Array.isArray(payload.periods)) return null;
  const h = payload.head;
  return {
    fiscalYear: payload.fiscalYear,
    head: { id: str(h.id), code: str(h.code), name: str(h.name), nature: str(h.nature), carryForward: h.carryForward === true },
    openingMinor: minor(payload.openingMinor),
    closingMinor: minor(payload.closingMinor),
    periods: payload.periods.filter(isObj).map((p) => ({
      period: str(p.period),
      openingMinor: minor(p.openingMinor),
      debitMinor: minor(p.debitMinor),
      creditMinor: minor(p.creditMinor),
      closingMinor: minor(p.closingMinor),
    })),
  };
}

/** A signed debit-positive balance as "₹1,000.00 Dr" / "₹1,000.00 Cr"; zero has no side. */
export function formatDrCr(signedMinor: string): string {
  const v = MINOR_RE.test(signedMinor) ? BigInt(signedMinor) : 0n;
  if (v === 0n) return formatMoney(0n);
  return `${formatMoney(v < 0n ? -v : v)} ${v > 0n ? "Dr" : "Cr"}`;
}
