/**
 * Interview calendar (checklist R-RA-0140 / 0141) — pure.
 *
 * Two parts, split by what is genuinely local vs genuinely external:
 *  - An RFC-5545 iCalendar (.ics) invite built LOCALLY from the interview — a
 *    real, standards-compliant artefact the candidate/panel can import into any
 *    calendar app. No third party involved, so it is always available.
 *  - Push-sync to an EXTERNAL provider (Google/Outlook) is behind a typed
 *    adapter seam + feature flag; until an adapter is wired we never fake a sync.
 */

export const CALENDAR_PROVIDERS = ["google", "outlook"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export interface IcsInput {
  uid: string;
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h, treated as UTC) */
  time: string;
  durationMinutes: number;
  organizerEmail?: string | undefined;
}

/** Fold and escape a text value per RFC 5545 (commas, semicolons, newlines). */
function escapeIcsText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** UTC timestamp in iCalendar basic format: YYYYMMDDTHHMMSSZ. */
export function toIcsStamp(date: string, time: string): string {
  const t = Date.parse(`${date}T${time}:00Z`);
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Build a single-event VCALENDAR. `nowMs` provides DTSTAMP (injectable for
 * deterministic tests). Returns CRLF-delimited iCalendar text.
 */
export function buildIcs(input: IcsInput, nowMs: number = Date.now()): string {
  const start = Date.parse(`${input.date}T${input.time}:00Z`);
  const endStamp = toIcsStampFromMs(start + input.durationMinutes * 60_000);
  const dtstamp = toIcsStampFromMs(nowMs);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CivitasOne//HRMS Recruitment//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toIcsStamp(input.date, input.time)}`,
    `DTEND:${endStamp}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    ...(input.description ? [`DESCRIPTION:${escapeIcsText(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    ...(input.organizerEmail ? [`ORGANIZER:mailto:${escapeIcsText(input.organizerEmail)}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

function toIcsStampFromMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** External calendar push-sync feature flag. Default OFF. */
export function calendarSyncEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_CALENDAR_SYNC_ENABLED === "true";
}

/** A calendar provider adapter (external seam). No stub fakes a real sync. */
export interface CalendarAdapter {
  readonly provider: CalendarProvider | "stub";
  /** Push an event; a real adapter returns the provider event id. */
  pushEvent(ics: string, opts: { interviewId: string }): Promise<{ provider: string; eventId: string }>;
}
