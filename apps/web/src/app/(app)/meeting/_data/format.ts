/** meeting feature — small shared display helpers. */

/**
 * Fixed display timezone. Meetings are a government record keyed to Indian
 * Standard Time; rendering/parsing in the browser's own zone (GAP-MEETING-
 * MEETINGS-NEW-02) silently shifts the instant for a clerk on a device set to
 * another zone. Pin everything to Asia/Kolkata so the wall-clock a clerk sees
 * and schedules is always IST regardless of the device locale/TZ.
 */
export const IST_TIME_ZONE = "Asia/Kolkata";

/** IST-friendly short time, e.g. "14:32". Falls back to "—" on bad input. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST_TIME_ZONE,
  });
}

/** IST date-time with an explicit "IST" suffix, e.g. "01 Sep 2026, 10:00 IST". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: IST_TIME_ZONE,
    }) + " IST"
  );
}

/**
 * Convert a browser `<input type="datetime-local">` value ("2026-09-01T10:00",
 * which carries NO zone) into a full ISO-8601 instant in IST (+05:30), so the
 * instant sent to the service is the wall-clock the clerk typed interpreted as
 * IST — not as the device's local zone (GAP-MEETING-MEETINGS-NEW-02). Returns
 * null for empty/malformed input so the caller can surface a validation error
 * rather than send `Invalid Date`.
 *
 * IST has a fixed +05:30 offset with no DST, so appending the literal offset
 * and re-serialising to UTC is exact and deterministic (no TZ-env dependence).
 */
export function istLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const withOffset = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`;
  const d = new Date(withOffset);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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
      // GAP-MEETING-MEETINGS-04: a cancelled meeting is a negative outcome and
      // must read differently from an archived (completed-and-filed) one — they
      // used to share the single "closed" variant, losing the distinction.
      return "rejected";
    case "archived":
      return "closed";
    case "adjourned":
    case "minutes_pending":
      return "pending";
    default:
      return status; // draft → mut
  }
}

/**
 * Human label for a meeting status, from a dictionary rather than humanize()
 * on the raw token (GAP-MEETING-MEETINGS-04 / GAP-MEETING-MEETINGS-MEETINGID-06):
 * a central map keeps labels translatable and lets related statuses read
 * distinctly ("Cancelled" vs "Archived") instead of a mechanical title-case of
 * the enum. Falls back to humanize() for any status not yet catalogued.
 */
const MEETING_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  agenda_locked: "Agenda locked",
  in_progress: "In progress",
  adjourned: "Adjourned",
  minutes_pending: "Minutes pending",
  minutes_approved: "Minutes approved",
  closed: "Closed",
  archived: "Archived",
  cancelled: "Cancelled",
};

export function meetingStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return MEETING_STATUS_LABELS[status] ?? humanize(status);
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
