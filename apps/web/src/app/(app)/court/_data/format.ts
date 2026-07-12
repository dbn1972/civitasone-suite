/** court feature — small shared display helpers. */

/** IST-friendly date-time, e.g. "12 Jul 2026, 14:32". Falls back to "—". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Calendar date only, e.g. "12 Jul 2026". Falls back to "—". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Title-case a snake/kebab enum token, e.g. "part_heard" → "Part heard". */
export function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? "—" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Present a stored CNR (16 alnum) as DLHC-01-000123-4 style groups for reading. */
export function fmtCnr(cnr: string | null | undefined): string {
  if (!cnr) return "—";
  return cnr;
}

/** Maps a case status onto a StatusPill variant token the ds kit understands. */
export function casePillStatus(status: string): string {
  switch (status) {
    case "disposed":
      return "completed";
    case "reserved":
    case "part_heard":
    case "pending":
      return "in progress";
    case "registered":
    case "admitted":
      return "open";
    case "appealed":
      return "review";
    default:
      return status; // filed → mut
  }
}

/** Maps an order issuance status onto a StatusPill variant token. */
export function orderPillStatus(status: string): string {
  switch (status) {
    case "issued":
      return "approved";
    case "pending_approval":
      return "submitted";
    case "recalled":
      return "rejected";
    default:
      return "draft";
  }
}

/** Maps a hearing status onto a StatusPill variant token. */
export function hearingPillStatus(status: string): string {
  switch (status) {
    case "held":
      return "completed";
    case "adjourned":
      return "pending";
    case "cancelled":
      return "closed";
    default:
      return "open"; // scheduled
  }
}

/** Today as YYYY-MM-DD (local) — the default date for cause lists / orders. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
