/**
 * UAT Phase 2 C4 (recon D22): the register's "Bid Window" cue. It used to read
 * "Open" for every tender that was not a published one past its close date,
 * so drafts and awarded / cancelled / under-evaluation tenders all showed "Open".
 * The window is only open while a tender is published and its bid-close date
 * has not passed.
 */
export type BidWindow = "not_published" | "open" | "closed_awaiting_opening" | "closed";

export function tenderBidWindow(status: string, bidClosingDate: string | null | undefined, todayIso: string): BidWindow {
  if (status === "draft") return "not_published";
  if (status === "published") {
    const close = (bidClosingDate ?? "").slice(0, 10);
    return close && close < todayIso ? "closed_awaiting_opening" : "open";
  }
  return "closed";
}
