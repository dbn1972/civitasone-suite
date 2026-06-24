/** Pure bank-reconciliation matching logic — no DB, no HTTP. */

export interface BookEntry {
  id: string;
  amountMinor: bigint;   // absolute paise
  /** posting/value date as YYYY-MM-DD */
  date: string;
  /** UTR / cheque / instrument reference, may be null */
  reference: string | null;
}

export interface StatementLine {
  id: string;
  amountMinor: bigint;   // absolute paise
  direction: "debit" | "credit";
  date: string;          // YYYY-MM-DD
  reference: string | null;
}

export interface MatchPair {
  lineId: string;
  bookId: string;
  /** reason the match was chosen — for audit/debug */
  basis: "reference+amount" | "amount+date";
}

const MS_PER_DAY = 86_400_000;

export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round((da - db) / MS_PER_DAY));
}

/** Normalise a reference for comparison: uppercase, strip non-alphanumerics. */
export function normRef(r: string | null | undefined): string {
  return (r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Greedy auto-matcher. Each statement line is matched to at most one book entry
 * (and vice-versa). Strategy, in priority order:
 *   1. exact amount + reference substring match (any date)
 *   2. exact amount + date within `nearDays`
 * `lines` are debit (money-out → match payments) OR credit (money-in → match receipts);
 * the caller passes the correct book side, so direction is informational here.
 */
export function autoMatch(
  lines: StatementLine[],
  books: BookEntry[],
  nearDays = 3,
): MatchPair[] {
  const usedBooks = new Set<string>();
  const pairs: MatchPair[] = [];

  // Pass 1: reference + amount (strongest signal)
  for (const line of lines) {
    const lref = normRef(line.reference);
    if (!lref) continue;
    const hit = books.find(
      (b) =>
        !usedBooks.has(b.id) &&
        b.amountMinor === line.amountMinor &&
        normRef(b.reference).length > 0 &&
        (normRef(b.reference).includes(lref) || lref.includes(normRef(b.reference))),
    );
    if (hit) {
      usedBooks.add(hit.id);
      pairs.push({ lineId: line.id, bookId: hit.id, basis: "reference+amount" });
    }
  }
  const matchedLines = new Set(pairs.map((p) => p.lineId));

  // Pass 2: amount + near-date for still-unmatched lines
  for (const line of lines) {
    if (matchedLines.has(line.id)) continue;
    const candidates = books
      .filter(
        (b) =>
          !usedBooks.has(b.id) &&
          b.amountMinor === line.amountMinor &&
          daysBetween(b.date, line.date) <= nearDays,
      )
      .sort((a, b) => daysBetween(a.date, line.date) - daysBetween(b.date, line.date));
    const hit = candidates[0];
    if (hit) {
      usedBooks.add(hit.id);
      pairs.push({ lineId: line.id, bookId: hit.id, basis: "amount+date" });
    }
  }

  return pairs;
}
