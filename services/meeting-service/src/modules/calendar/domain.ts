/**
 * Calendar module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 14.1–14.8):
 *   - Conflict detection (Req 14.3):
 *       · room double-booking over half-open `[start, end)` intervals (property P28),
 *       · mandatory-participant overlap with another meeting,
 *       · statutory same-day conflict (two statutory meetings of the same type on one day).
 *   - Recurring pattern generation (Req 14.5): daily / weekly / bi-weekly / monthly /
 *     quarterly / annual occurrence enumeration.
 *   - Availability-window computation and slot suggestion (Req 14.1): subtract busy intervals
 *     from a requested range to yield free windows, then slice windows into candidate slots.
 *   - ICS (RFC 5545) file generation and parsing (Req 14.7) with an export → parse round-trip.
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so the
 * standard error envelope + HTTP status contract is preserved end-to-end. These functions remain
 * pure: they perform no I/O and are deterministic given their inputs (callers inject `now` where
 * time matters). All instants are treated as absolute (UTC) `Date`s, matching the `timestamptz`
 * columns; "same day" comparisons use the UTC calendar date unless a `dayKey` is supplied.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_
 */
import { httpError } from "../../shared/context.js";

// ─── Domain vocabularies (mirror the migration value sets) ────────────────────

/** Room lifecycle / availability states. Only `active` rooms may accept new bookings (Req 14.2). */
export const ROOM_STATUSES = ["active", "inactive", "maintenance"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Booking states. Only `confirmed` bookings participate in conflict detection (Req 14.3, P28). */
export const ROOM_BOOKING_STATUSES = ["confirmed", "cancelled"] as const;
export type RoomBookingStatus = (typeof ROOM_BOOKING_STATUSES)[number];

/**
 * Recurring meeting patterns (Req 14.5). `bi_weekly` is every second week (14 days). Ordinal
 * position is not significant; the step semantics are defined in `advance` below.
 */
export const RECURRENCE_PATTERNS = [
  "daily",
  "weekly",
  "bi_weekly",
  "monthly",
  "quarterly",
  "annual",
] as const;
export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number];

const MS_PER_MINUTE = 60 * 1000;
/** Safety cap so a malformed unbounded rule can never enumerate forever (Req 14.5). */
export const MAX_OCCURRENCES = 1000;

// ─── Intervals & overlap ──────────────────────────────────────────────────────

/** A half-open time interval `[start, end)`. `end` must be strictly after `start`. */
export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Half-open `[start, end)` overlap test: two intervals overlap iff each starts before the other
 * ends. Adjacency does NOT count as overlap — a booking ending exactly when another begins is
 * conflict-free (matches the database `tstzrange(start, end)` `&&` exclusion semantics, P28).
 */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Assert a well-formed interval (`end` strictly after `start`); throws `VALIDATION_FAILED` (400). */
export function assertValidInterval(start: Date, end: Date): void {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError("VALIDATION_FAILED", "start and end must be valid dates");
  }
  if (end.getTime() <= start.getTime()) {
    throw httpError("VALIDATION_FAILED", "end must be strictly after start", {
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
}

// ─── Room double-booking (Req 14.3 · P28) ─────────────────────────────────────

/** Minimal shape needed to reason about a room booking; the persisted row is a superset. */
export interface RoomBookingLike {
  id?: string;
  roomId: string;
  startAt: Date;
  endAt: Date;
  status?: string | null;
}

function isConfirmed(b: RoomBookingLike): boolean {
  return (b.status ?? "confirmed") === "confirmed";
}

/**
 * True when two bookings conflict: same room, both `confirmed`, and overlapping `[start, end)`.
 * A booking never conflicts with itself when `id`s match (used when re-checking an update).
 */
export function bookingsConflict(a: RoomBookingLike, b: RoomBookingLike): boolean {
  if (a.id !== undefined && a.id === b.id) return false;
  return (
    a.roomId === b.roomId &&
    isConfirmed(a) &&
    isConfirmed(b) &&
    intervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)
  );
}

/** Return every existing booking that conflicts with `candidate` (Req 14.3). */
export function findRoomConflicts(
  existing: readonly RoomBookingLike[],
  candidate: RoomBookingLike,
): RoomBookingLike[] {
  return existing.filter((b) => bookingsConflict(candidate, b));
}

/**
 * Assert `candidate` does not double-book its room against any `existing` booking (Req 14.3, P28).
 * Throws `ROOM_DOUBLE_BOOKED` (409) with the conflicting booking ids/window on violation. This is
 * the application-layer mirror of the database `room_bookings_no_overlap` exclusion constraint.
 */
export function assertNoRoomConflict(existing: readonly RoomBookingLike[], candidate: RoomBookingLike): void {
  assertValidInterval(candidate.startAt, candidate.endAt);
  const conflicts = findRoomConflicts(existing, candidate);
  if (conflicts.length > 0) {
    throw httpError("ROOM_DOUBLE_BOOKED", "room is already booked for an overlapping period", {
      roomId: candidate.roomId,
      requested: { startAt: candidate.startAt.toISOString(), endAt: candidate.endAt.toISOString() },
      conflicts: conflicts.map((c) => ({
        bookingId: c.id ?? null,
        startAt: c.startAt.toISOString(),
        endAt: c.endAt.toISOString(),
      })),
    });
  }
}

// ─── Participant overlap (Req 14.3) ────────────────────────────────────────────

/** A period during which a participant is already committed (another meeting / travel / leave). */
export interface ParticipantBusyInterval {
  participantId: string;
  start: Date;
  end: Date;
  /** Optional source reference (meeting id, leave id, …) surfaced in conflict details. */
  ref?: string;
}

/** A detected participant clash: the participant and the busy interval that overlaps the window. */
export interface ParticipantConflict {
  participantId: string;
  start: Date;
  end: Date;
  ref?: string;
}

/**
 * Return the busy intervals of `participantIds` that overlap `window` (Req 14.3). Only the listed
 * participants are considered (mandatory attendees); busy intervals for others are ignored.
 */
export function findParticipantConflicts(
  busy: readonly ParticipantBusyInterval[],
  participantIds: readonly string[],
  window: Interval,
): ParticipantConflict[] {
  const wanted = new Set(participantIds);
  return busy
    .filter((b) => wanted.has(b.participantId) && intervalsOverlap(b.start, b.end, window.start, window.end))
    .map((b) => ({ participantId: b.participantId, start: b.start, end: b.end, ...(b.ref ? { ref: b.ref } : {}) }));
}

// ─── Statutory same-day conflict (Req 14.3) ───────────────────────────────────

/** Minimal shape for statutory-conflict reasoning: a statutory meeting of some type at an instant. */
export interface StatutoryMeetingLike {
  meetingId?: string;
  /** Meeting type key (e.g. "finance_committee"); a same-type + same-day clash is a conflict. */
  type: string;
  isStatutory?: boolean;
  scheduledAt: Date;
}

/** UTC calendar-day key `YYYY-MM-DD` for an instant. */
export function utcDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Return existing statutory meetings that clash with `candidate` (Req 14.3): both are statutory,
 * share the same `type`, and fall on the same calendar day. Day bucketing uses UTC by default; a
 * `dayKey` mapper may be injected to bucket by a tenant-local day instead.
 */
export function findStatutoryConflicts(
  existing: readonly StatutoryMeetingLike[],
  candidate: StatutoryMeetingLike,
  dayKey: (d: Date) => string = utcDayKey,
): StatutoryMeetingLike[] {
  if (!candidate.isStatutory) return [];
  const day = dayKey(candidate.scheduledAt);
  return existing.filter(
    (m) =>
      m.isStatutory === true &&
      m.type === candidate.type &&
      (candidate.meetingId === undefined || m.meetingId !== candidate.meetingId) &&
      dayKey(m.scheduledAt) === day,
  );
}

// ─── Combined conflict check (Req 14.3, 14.4) ─────────────────────────────────

/** Aggregate result of a scheduling conflict check across all three conflict classes. */
export interface ConflictReport {
  room: RoomBookingLike[];
  participants: ParticipantConflict[];
  statutory: StatutoryMeetingLike[];
  hasConflict: boolean;
}

/**
 * Detect all scheduling conflicts for a proposed meeting window (Req 14.3). Returns a structured
 * report (rather than throwing) so the caller can present conflict details and alternatives to the
 * secretary (Req 14.4). Any of the three inputs may be omitted when not applicable.
 */
export function detectConflicts(input: {
  window: Interval;
  roomBooking?: RoomBookingLike;
  existingRoomBookings?: readonly RoomBookingLike[];
  mandatoryParticipantIds?: readonly string[];
  participantBusy?: readonly ParticipantBusyInterval[];
  candidateMeeting?: StatutoryMeetingLike;
  existingStatutoryMeetings?: readonly StatutoryMeetingLike[];
}): ConflictReport {
  assertValidInterval(input.window.start, input.window.end);

  const room =
    input.roomBooking && input.existingRoomBookings
      ? findRoomConflicts(input.existingRoomBookings, input.roomBooking)
      : [];

  const participants =
    input.mandatoryParticipantIds && input.participantBusy
      ? findParticipantConflicts(input.participantBusy, input.mandatoryParticipantIds, input.window)
      : [];

  const statutory =
    input.candidateMeeting && input.existingStatutoryMeetings
      ? findStatutoryConflicts(input.existingStatutoryMeetings, input.candidateMeeting)
      : [];

  return {
    room,
    participants,
    statutory,
    hasConflict: room.length > 0 || participants.length > 0 || statutory.length > 0,
  };
}

// ─── Recurring pattern generation (Req 14.5) ──────────────────────────────────

/** Add `n` calendar months to `d` in UTC, clamping the day to the target month's length. */
function addUtcMonths(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(day, lastDay),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Advance an occurrence instant by one step of `pattern`, preserving time-of-day (UTC). */
export function advance(from: Date, pattern: RecurrencePattern): Date {
  switch (pattern) {
    case "daily":
      return new Date(from.getTime() + 24 * 60 * MS_PER_MINUTE);
    case "weekly":
      return new Date(from.getTime() + 7 * 24 * 60 * MS_PER_MINUTE);
    case "bi_weekly":
      return new Date(from.getTime() + 14 * 24 * 60 * MS_PER_MINUTE);
    case "monthly":
      return addUtcMonths(from, 1);
    case "quarterly":
      return addUtcMonths(from, 3);
    case "annual":
      return addUtcMonths(from, 12);
    default: {
      const _exhaustive: never = pattern;
      throw httpError("VALIDATION_FAILED", `unsupported recurrence pattern: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Enumerate recurring occurrence start instants for a series (Req 14.5). Generation starts at
 * `start` (always the first occurrence) and steps by `pattern` until either the (inclusive)
 * `until` bound is passed or `count` occurrences have been produced. Exactly one of `until` /
 * `count` must be supplied; the result is hard-capped at `MAX_OCCURRENCES`.
 *
 * Pure and deterministic. Callers derive per-instance meeting rows (with membership /
 * action-item carry-forward) from these instants downstream.
 */
export function generateOccurrences(opts: {
  pattern: RecurrencePattern;
  start: Date;
  until?: Date;
  count?: number;
}): Date[] {
  const { pattern, start, until, count } = opts;
  if (Number.isNaN(start.getTime())) {
    throw httpError("VALIDATION_FAILED", "start must be a valid date");
  }
  const hasUntil = until !== undefined;
  const hasCount = count !== undefined;
  if (hasUntil === hasCount) {
    throw httpError("VALIDATION_FAILED", "exactly one of 'until' or 'count' must be supplied");
  }
  if (hasUntil && Number.isNaN(until!.getTime())) {
    throw httpError("VALIDATION_FAILED", "until must be a valid date");
  }
  if (hasUntil && until!.getTime() < start.getTime()) {
    throw httpError("VALIDATION_FAILED", "until must be on or after start", {
      start: start.toISOString(),
      until: until!.toISOString(),
    });
  }
  if (hasCount && (!Number.isInteger(count) || count! < 0)) {
    throw httpError("VALIDATION_FAILED", "count must be a non-negative integer");
  }

  const limit = hasCount ? Math.min(count!, MAX_OCCURRENCES) : MAX_OCCURRENCES;
  const out: Date[] = [];
  let current = new Date(start.getTime());
  while (out.length < limit) {
    if (hasUntil && current.getTime() > until!.getTime()) break;
    out.push(new Date(current.getTime()));
    current = advance(current, pattern);
  }
  return out;
}

// ─── Availability windows & slot suggestion (Req 14.1) ────────────────────────

/**
 * Sort and merge overlapping / adjacent intervals into a minimal disjoint set. Adjacent intervals
 * (`a.end === b.start`) are merged so the complement (free windows) has no zero-length gaps.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((iv) => iv.end.getTime() > iv.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = new Date(iv.end.getTime());
    } else {
      merged.push({ start: new Date(iv.start.getTime()), end: new Date(iv.end.getTime()) });
    }
  }
  return merged;
}

/**
 * Compute free windows within `range` given a set of `busy` intervals (Req 14.1): the complement
 * of the merged busy set, clipped to the range. Windows shorter than `minDurationMinutes` (when
 * supplied) are dropped, so the result contains only windows that can actually host a meeting of
 * the required length.
 */
export function computeAvailability(
  busy: readonly Interval[],
  range: Interval,
  opts?: { minDurationMinutes?: number },
): Interval[] {
  assertValidInterval(range.start, range.end);
  const minMs = Math.max(0, opts?.minDurationMinutes ?? 0) * MS_PER_MINUTE;

  // Clip busy intervals to the range before merging.
  const clipped: Interval[] = [];
  for (const iv of busy) {
    const s = Math.max(iv.start.getTime(), range.start.getTime());
    const e = Math.min(iv.end.getTime(), range.end.getTime());
    if (e > s) clipped.push({ start: new Date(s), end: new Date(e) });
  }
  const merged = mergeIntervals(clipped);

  const free: Interval[] = [];
  let cursor = range.start.getTime();
  for (const iv of merged) {
    if (iv.start.getTime() > cursor) free.push({ start: new Date(cursor), end: new Date(iv.start.getTime()) });
    cursor = Math.max(cursor, iv.end.getTime());
  }
  if (cursor < range.end.getTime()) free.push({ start: new Date(cursor), end: new Date(range.end.getTime()) });

  return minMs > 0 ? free.filter((w) => w.end.getTime() - w.start.getTime() >= minMs) : free;
}

/**
 * Suggest concrete candidate start slots of `slotMinutes` length within the free windows of
 * `range` (Req 14.1). Slots are laid out from each window's start, stepping by `stepMinutes`
 * (defaults to the slot length for non-overlapping back-to-back slots). The number of returned
 * slots is capped by `limit` (defaults to `MAX_OCCURRENCES`).
 */
export function suggestSlots(
  busy: readonly Interval[],
  range: Interval,
  slotMinutes: number,
  opts?: { stepMinutes?: number; limit?: number },
): Interval[] {
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
    throw httpError("VALIDATION_FAILED", "slotMinutes must be a positive number");
  }
  const slotMs = slotMinutes * MS_PER_MINUTE;
  const stepMs = Math.max(1, (opts?.stepMinutes ?? slotMinutes)) * MS_PER_MINUTE;
  const limit = Math.max(0, opts?.limit ?? MAX_OCCURRENCES);

  const windows = computeAvailability(busy, range, { minDurationMinutes: slotMinutes });
  const slots: Interval[] = [];
  for (const w of windows) {
    let s = w.start.getTime();
    while (s + slotMs <= w.end.getTime()) {
      if (slots.length >= limit) return slots;
      slots.push({ start: new Date(s), end: new Date(s + slotMs) });
      s += stepMs;
    }
  }
  return slots;
}

// ─── ICS (RFC 5545) generation & parsing (Req 14.7) ───────────────────────────

/** A calendar event, the unit of ICS export/parse. Times are absolute instants (emitted as UTC). */
export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizerEmail?: string;
  /** Revision sequence (RFC 5545 SEQUENCE); defaults to 0 on export. */
  sequence?: number;
}

/** Format an instant as an RFC 5545 UTC date-time (`YYYYMMDDTHHMMSSZ`). */
export function formatIcsUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) throw httpError("VALIDATION_FAILED", "cannot format invalid date to ICS");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Parse an RFC 5545 UTC date-time (`YYYYMMDDTHHMMSSZ`) into a `Date`. */
export function parseIcsUtc(value: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!m) throw httpError("VALIDATION_FAILED", `invalid ICS UTC date-time: ${value}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

/** Escape a text value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeIcsText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Reverse `escapeIcsText`. */
function unescapeIcsText(v: string): string {
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]!;
    if (ch === "\\" && i + 1 < v.length) {
      const next = v[++i]!;
      out += next === "n" || next === "N" ? "\n" : next;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Fold a content line to ≤75 octets per RFC 5545 §3.1 (continuations begin with a single space). */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(" " + rest);
  return parts.join("\r\n");
}

/**
 * Serialise events into an RFC 5545 VCALENDAR document (Req 14.7), compatible with Outlook, Google
 * Calendar, and government email clients. Text values are escaped and long lines folded. The
 * output round-trips through `parseIcs` (see property P23 / test): every field emitted here is
 * recovered by the parser.
 */
export function generateIcs(events: readonly IcsEvent[], opts?: { prodId?: string; calName?: string }): string {
  const prodId = opts?.prodId ?? "-//CivitasOne//Meeting Service//EN";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeIcsText(prodId)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (opts?.calName) lines.push(`X-WR-CALNAME:${escapeIcsText(opts.calName)}`);

  for (const ev of events) {
    if (!ev.uid || ev.uid.trim() === "") throw httpError("VALIDATION_FAILED", "ICS event requires a uid");
    assertValidInterval(ev.start, ev.end);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(ev.uid)}`);
    lines.push(`DTSTAMP:${formatIcsUtc(ev.start)}`);
    lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
    lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description !== undefined) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    if (ev.location !== undefined) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.url !== undefined) lines.push(`URL:${escapeIcsText(ev.url)}`);
    if (ev.organizerEmail !== undefined) lines.push(`ORGANIZER:mailto:${ev.organizerEmail}`);
    lines.push(`SEQUENCE:${ev.sequence ?? 0}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Unfold RFC 5545 content lines: a CRLF/LF followed by a space or tab is a line continuation. */
function unfold(ics: string): string[] {
  const raw = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

/** Split a content line into its property name (upper-cased, params stripped) and raw value. */
function splitProperty(line: string): { name: string; value: string } {
  const idx = line.indexOf(":");
  if (idx === -1) return { name: line.toUpperCase(), value: "" };
  const namePart = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const name = namePart.split(";")[0]!.toUpperCase();
  return { name, value };
}

/**
 * Parse an ICS document into events (Req 14.7). Inverse of `generateIcs`: unfolds continuation
 * lines, unescapes text, and maps DTSTART/DTEND back to instants. Malformed dates or events
 * missing required fields (uid, start, end, summary) raise `VALIDATION_FAILED` (400).
 */
export function parseIcs(ics: string): IcsEvent[] {
  const lines = unfold(ics);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let cur: Partial<IcsEvent> & { _hasStart?: boolean; _hasEnd?: boolean } = {};

  for (const line of lines) {
    const { name, value } = splitProperty(line);
    if (name === "BEGIN" && value.toUpperCase() === "VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (name === "END" && value.toUpperCase() === "VEVENT") {
      if (!cur.uid || !cur._hasStart || !cur._hasEnd || cur.summary === undefined) {
        throw httpError("VALIDATION_FAILED", "ICS VEVENT missing required UID/DTSTART/DTEND/SUMMARY");
      }
      const { _hasStart, _hasEnd, ...ev } = cur;
      events.push(ev as IcsEvent);
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;

    switch (name) {
      case "UID":
        cur.uid = unescapeIcsText(value);
        break;
      case "DTSTART":
        cur.start = parseIcsUtc(value);
        cur._hasStart = true;
        break;
      case "DTEND":
        cur.end = parseIcsUtc(value);
        cur._hasEnd = true;
        break;
      case "SUMMARY":
        cur.summary = unescapeIcsText(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeIcsText(value);
        break;
      case "LOCATION":
        cur.location = unescapeIcsText(value);
        break;
      case "URL":
        cur.url = unescapeIcsText(value);
        break;
      case "ORGANIZER":
        cur.organizerEmail = value.replace(/^mailto:/i, "");
        break;
      case "SEQUENCE": {
        const n = Number(value);
        if (Number.isInteger(n)) cur.sequence = n;
        break;
      }
      default:
        break;
    }
  }
  return events;
}
