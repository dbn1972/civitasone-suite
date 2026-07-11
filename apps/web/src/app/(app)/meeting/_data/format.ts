/** meeting feature — small shared display helpers. */

/** IST-friendly short time, e.g. "14:32". Falls back to "—" on bad input. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

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

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Title-case a snake/kebab enum token, e.g. "agenda_locked" → "Agenda locked". */
export function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? "—" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Statuses that count as "in the room" for quorum (present + joined_late, Req 6.4). */
export function presentForQuorum(counts: {
  present: number;
  joinedLate: number;
}): number {
  return counts.present + counts.joinedLate;
}

/** Maps a meeting status onto a StatusPill variant token the ds kit understands. */
export function meetingPillStatus(status: string): string {
  switch (status) {
    case "in_progress":
      return "in progress";
    case "minutes_approved":
    case "closed":
      return "completed";
    case "scheduled":
    case "agenda_locked":
      return "open";
    case "cancelled":
    case "archived":
      return "closed";
    case "adjourned":
    case "minutes_pending":
      return "pending";
    default:
      return status; // draft → mut
  }
}

/** Maps a vote result/projection onto a StatusPill variant token. */
export function votePillStatus(result: string): string {
  switch (result) {
    case "passed":
      return "passed";
    case "rejected":
    case "invalid":
      return "rejected";
    default:
      return "pending";
  }
}
