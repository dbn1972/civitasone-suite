/**
 * UAT Phase 2 C4 (recon D22): the register's "Bid Window" cue. It used to read
 * "Open" for every tender that was not a published one past its close date,
 * so drafts and awarded / cancelled / under-evaluation tenders all showed "Open".
 * The window is only open while a tender is published and its bid-close has
 * not passed.
 *
 * Security review #2446 (8): compare the closing INSTANT, not the date string.
 * A full timestamp (e.g. `2026-11-03T15:00:00+05:30`) is compared exactly. A
 * date-only value — what procurement-service stores today (`bid_closing_date`
 * is a DATE column, no closing time) — closes at the end of that day in IST
 * (23:59:59.999 +05:30), the latest the stated date allows. IST is a fixed
 * +05:30 offset (no DST); it is used to interpret a bare date and for display
 * only, never by comparing local date strings.
 */
export type BidWindow = "not_published" | "open" | "closed_awaiting_opening" | "closed";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Epoch ms at which bidding closes, or null when the value is missing / unreadable. */
export function bidClosingInstant(bidClosingDate: string | null | undefined): number | null {
  const v = (bidClosingDate ?? "").trim();
  if (!v) return null;
  const ms = DATE_ONLY.test(v) ? Date.parse(`${v}T23:59:59.999+05:30`) : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function tenderBidWindow(status: string, bidClosingDate: string | null | undefined, now: Date = new Date()): BidWindow {
  if (status === "draft") return "not_published";
  if (status === "published") {
    const closesAt = bidClosingInstant(bidClosingDate);
    return closesAt !== null && now.getTime() > closesAt ? "closed_awaiting_opening" : "open";
  }
  return "closed";
}
