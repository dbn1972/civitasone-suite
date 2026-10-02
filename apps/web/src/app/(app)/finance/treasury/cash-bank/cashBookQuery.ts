/**
 * GAP-FINANCE-TREASURY-CASH-BANK-01: parse the cash-book filter from the page's
 * search params. Anything that is not a known account type or a real
 * YYYY-MM-DD calendar date is dropped (never forwarded to the API).
 */
import type { CashBookQuery } from "@/app/_data/loaders";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDay(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = ISO_DAY.exec(v);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v ? v : undefined;
}

export function parseCashBookQuery(sp: { type?: string; from?: string; to?: string } | undefined): CashBookQuery {
  const type = sp?.type === "cash" || sp?.type === "bank" ? sp.type : undefined;
  let from = validDay(sp?.from);
  let to = validDay(sp?.to);
  if (from && to && from > to) {
    // a reversed range would silently match nothing -- swap it
    [from, to] = [to, from];
  }
  return { ...(type ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** Stable client-cache key so each filter combination keeps its own cached copy. */
export function cashBookCacheKey(q: CashBookQuery): string {
  return `finance.cashbook:${q.type ?? "all"}:${q.from ?? ""}:${q.to ?? ""}`;
}

export function periodLabel(q: CashBookQuery, formatDay: (iso: string) => string): string {
  const acct = q.type === "cash" ? "cash" : q.type === "bank" ? "bank" : "cash & bank";
  if (q.from && q.to) return `${acct} book entries between ${formatDay(q.from)} and ${formatDay(q.to)}`;
  if (q.from) return `${acct} book entries from ${formatDay(q.from)}`;
  if (q.to) return `${acct} book entries up to ${formatDay(q.to)}`;
  return `${acct} book entries`;
}
