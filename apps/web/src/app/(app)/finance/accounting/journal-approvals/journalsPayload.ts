/**
 * UAT b15 (item 6): the GET /v1/finance/journals/pending and /rejected payload, mapped to rows the journal approvals
 * screen can trust.
 *
 * Deliberately a plain module, not the "use client" JournalApprovals.tsx. The Server Component page passes
 * mapPendingJournals to fetchJson as mapResponse; imported from a client module, the function is a client reference
 * on the server, calling it throws, fetchJson caught that as a network error, and the screen showed
 * "We couldn’t connect" although the API answered 200 (UAT L1 post-b14). Same class as grants/applications/filters.ts.
 */
export type PendingJournalLine = { accountCode: string; debitMinor: string; creditMinor: string; narration: string | null };
export type PendingJournal = {
  id: string;
  voucherNo: string | null;
  type: string;
  postingDate: string;
  narration: string | null;
  totalMinor: string;
  lines: PendingJournalLine[];
  createdAt: string;
  isOwn: boolean;
  /** Rejected journals only: why and when. */
  rejectionReason?: string | null;
  decidedAt?: string | null;
};

const DIGITS = /^\d{1,38}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** GET /v1/finance/journals/pending (or /rejected) -> rows the screen can trust; null when the payload is not that shape. */
export function mapPendingJournals(payload: unknown): PendingJournal[] | null {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  const out: PendingJournal[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = str(r?.id);
    const total = str(r?.totalMinor);
    if (!id || !total || !DIGITS.test(total) || !Array.isArray(r.lines)) continue;
    out.push({
      id,
      voucherNo: str(r.voucherNo),
      type: str(r.type) ?? "journal",
      postingDate: str(r.postingDate) ?? "",
      narration: str(r.narration),
      totalMinor: total,
      lines: (r.lines as Array<Record<string, unknown>>).map((l) => ({
        accountCode: str(l?.accountCode) ?? "",
        debitMinor: str(l?.debitMinor) ?? "0",
        creditMinor: str(l?.creditMinor) ?? "0",
        narration: str(l?.narration),
      })),
      createdAt: str(r.createdAt) ?? "",
      isOwn: r.isOwn === true,
      rejectionReason: str(r.rejectionReason),
      decidedAt: str(r.decidedAt),
    });
  }
  return out;
}
