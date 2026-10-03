/**
 * GAP-ASSETS-DEPRECIATION-02: pure model of GET /v1/asset/depreciation/status, which tells the run page
 * what a run for the chosen period would post (preview), what is already posted, and the last posted period.
 * Amounts are minor-unit strings (paise) end to end -- never Number.
 */
export type BookStatus = {
  depBook: string;
  pendingCount: number;
  pendingMinor: string;
  postedCount: number;
  postedMinor: string;
  lastPostedAt: string | null;
};

export type RunStatus = {
  period: string;
  books: BookStatus[];
  lastPosted: { period: string; postedAt: string } | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const minorString = (v: unknown): string => (typeof v === "string" && /^\d+$/.test(v) ? v : "0");
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

export function parseRunStatus(payload: unknown): RunStatus | null {
  if (!isRecord(payload) || typeof payload.period !== "string" || !Array.isArray(payload.books)) return null;
  const books: BookStatus[] = [];
  for (const b of payload.books) {
    if (!isRecord(b) || typeof b.depBook !== "string") continue;
    books.push({
      depBook: b.depBook,
      pendingCount: count(b.pendingCount),
      pendingMinor: minorString(b.pendingMinor),
      postedCount: count(b.postedCount),
      postedMinor: minorString(b.postedMinor),
      lastPostedAt: typeof b.lastPostedAt === "string" ? b.lastPostedAt : null,
    });
  }
  const lp = payload.lastPosted;
  const lastPosted = isRecord(lp) && typeof lp.period === "string" && typeof lp.postedAt === "string"
    ? { period: lp.period, postedAt: lp.postedAt } : null;
  return { period: payload.period, books, lastPosted };
}

/** "no_entries": no schedule entry exists for the period; "already_posted": all posted; otherwise "ready". */
export type RunState = "no_entries" | "already_posted" | "ready";

export function runState(status: RunStatus): RunState {
  if (status.books.length === 0) return "no_entries";
  const pending = status.books.reduce((n, b) => n + b.pendingCount, 0);
  if (pending > 0) return "ready";
  return "already_posted";
}

export function pendingTotals(status: RunStatus): { count: number; minor: string } {
  let minor = 0n;
  let n = 0;
  for (const b of status.books) {
    n += b.pendingCount;
    minor += BigInt(b.pendingMinor);
  }
  return { count: n, minor: minor.toString() };
}

export function postedTotals(status: RunStatus): { count: number; minor: string } {
  let minor = 0n;
  let n = 0;
  for (const b of status.books) {
    n += b.postedCount;
    minor += BigInt(b.postedMinor);
  }
  return { count: n, minor: minor.toString() };
}
