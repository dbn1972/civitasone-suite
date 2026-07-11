/**
 * Calendar module — pure domain unit tests (task 15.2 coverage companion).
 *
 * domain.ts is pure (no I/O), so these run in-memory with no DB. They exercise the interval /
 * conflict / recurrence / availability / ICS logic that the consumer + repo build on, keeping the
 * calendar module ≥80% line coverage. (The named property P28 lives in task 15.3.)
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  intervalsOverlap,
  assertValidInterval,
  bookingsConflict,
  findRoomConflicts,
  assertNoRoomConflict,
  findParticipantConflicts,
  utcDayKey,
  findStatutoryConflicts,
  detectConflicts,
  advance,
  generateOccurrences,
  mergeIntervals,
  computeAvailability,
  suggestSlots,
  formatIcsUtc,
  parseIcsUtc,
  generateIcs,
  parseIcs,
  type Interval,
} from "../src/modules/calendar/domain.js";

const d = (iso: string) => new Date(iso);

// ─── Intervals ─────────────────────────────────────────────────────────────

describe("intervals", () => {
  it("intervalsOverlap: half-open — adjacency does not overlap", () => {
    expect(intervalsOverlap(d("2030-01-01T10:00Z"), d("2030-01-01T11:00Z"), d("2030-01-01T10:30Z"), d("2030-01-01T11:30Z"))).toBe(true);
    // touching at the boundary is not an overlap
    expect(intervalsOverlap(d("2030-01-01T10:00Z"), d("2030-01-01T11:00Z"), d("2030-01-01T11:00Z"), d("2030-01-01T12:00Z"))).toBe(false);
  });

  it("assertValidInterval: accepts a well-formed interval, rejects bad ones", () => {
    expect(() => assertValidInterval(d("2030-01-01T10:00Z"), d("2030-01-01T11:00Z"))).not.toThrow();
    expect(() => assertValidInterval(d("2030-01-01T11:00Z"), d("2030-01-01T10:00Z"))).toThrow(HttpError);
    expect(() => assertValidInterval(new Date("nope"), d("2030-01-01T11:00Z"))).toThrow(HttpError);
  });
});

// ─── Room conflicts (P28 shape) ──────────────────────────────────────────────

describe("room conflicts", () => {
  const base = { roomId: "r1", startAt: d("2030-01-01T10:00Z"), endAt: d("2030-01-01T11:00Z"), status: "confirmed" as const };

  it("bookingsConflict: same room + confirmed + overlap; ignores self and cancelled", () => {
    expect(bookingsConflict(base, { roomId: "r1", startAt: d("2030-01-01T10:30Z"), endAt: d("2030-01-01T11:30Z") })).toBe(true);
    expect(bookingsConflict(base, { roomId: "r2", startAt: d("2030-01-01T10:30Z"), endAt: d("2030-01-01T11:30Z") })).toBe(false);
    expect(bookingsConflict(base, { roomId: "r1", startAt: d("2030-01-01T10:30Z"), endAt: d("2030-01-01T11:30Z"), status: "cancelled" })).toBe(false);
    expect(bookingsConflict({ ...base, id: "x" }, { id: "x", roomId: "r1", startAt: base.startAt, endAt: base.endAt })).toBe(false);
  });

  it("findRoomConflicts + assertNoRoomConflict throw ROOM_DOUBLE_BOOKED (409)", () => {
    const existing = [{ id: "b1", roomId: "r1", startAt: d("2030-01-01T10:30Z"), endAt: d("2030-01-01T11:30Z"), status: "confirmed" }];
    expect(findRoomConflicts(existing, base)).toHaveLength(1);
    try {
      assertNoRoomConflict(existing, base);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("ROOM_DOUBLE_BOOKED");
      expect((err as HttpError).status).toBe(409);
    }
    expect(() => assertNoRoomConflict([], base)).not.toThrow();
  });
});

// ─── Participant + statutory conflicts ────────────────────────────────────────

describe("participant & statutory conflicts", () => {
  it("findParticipantConflicts: only wanted participants overlapping the window", () => {
    const busy = [
      { participantId: "p1", start: d("2030-01-01T10:30Z"), end: d("2030-01-01T11:30Z"), ref: "m1" },
      { participantId: "p2", start: d("2030-01-01T10:30Z"), end: d("2030-01-01T11:30Z") },
    ];
    const window: Interval = { start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") };
    const conflicts = findParticipantConflicts(busy, ["p1"], window);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.ref).toBe("m1");
  });

  it("utcDayKey + findStatutoryConflicts: same type + same day + both statutory", () => {
    expect(utcDayKey(d("2030-01-01T23:59Z"))).toBe("2030-01-01");
    const existing = [
      { meetingId: "m1", type: "finance", isStatutory: true, scheduledAt: d("2030-01-01T15:00Z") },
      { meetingId: "m2", type: "finance", isStatutory: true, scheduledAt: d("2030-01-02T15:00Z") },
    ];
    const candidate = { meetingId: "m9", type: "finance", isStatutory: true, scheduledAt: d("2030-01-01T09:00Z") };
    expect(findStatutoryConflicts(existing, candidate)).toHaveLength(1);
    // Non-statutory candidate → never conflicts.
    expect(findStatutoryConflicts(existing, { ...candidate, isStatutory: false })).toHaveLength(0);
  });

  it("detectConflicts: aggregates room + participant + statutory", () => {
    const report = detectConflicts({
      window: { start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") },
      roomBooking: { roomId: "r1", startAt: d("2030-01-01T10:00Z"), endAt: d("2030-01-01T11:00Z") },
      existingRoomBookings: [{ id: "b1", roomId: "r1", startAt: d("2030-01-01T10:30Z"), endAt: d("2030-01-01T12:00Z"), status: "confirmed" }],
    });
    expect(report.hasConflict).toBe(true);
    expect(report.room).toHaveLength(1);
    // No inputs → no conflict.
    expect(detectConflicts({ window: { start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") } }).hasConflict).toBe(false);
  });
});

// ─── Recurrence (Req 14.5) ────────────────────────────────────────────────────

describe("recurrence", () => {
  it("advance: steps each pattern", () => {
    const from = d("2030-01-15T09:00Z");
    expect(advance(from, "daily").toISOString()).toBe("2030-01-16T09:00:00.000Z");
    expect(advance(from, "weekly").toISOString()).toBe("2030-01-22T09:00:00.000Z");
    expect(advance(from, "bi_weekly").toISOString()).toBe("2030-01-29T09:00:00.000Z");
    expect(advance(from, "monthly").toISOString()).toBe("2030-02-15T09:00:00.000Z");
    expect(advance(from, "quarterly").toISOString()).toBe("2030-04-15T09:00:00.000Z");
    expect(advance(from, "annual").toISOString()).toBe("2031-01-15T09:00:00.000Z");
  });

  it("advance: monthly clamps to a shorter month", () => {
    expect(advance(d("2030-01-31T09:00Z"), "monthly").toISOString()).toBe("2030-02-28T09:00:00.000Z");
  });

  it("generateOccurrences: by count and by until; validates args", () => {
    expect(generateOccurrences({ pattern: "weekly", start: d("2030-01-01T09:00Z"), count: 3 })).toHaveLength(3);
    const byUntil = generateOccurrences({ pattern: "daily", start: d("2030-01-01T09:00Z"), until: d("2030-01-03T09:00Z") });
    expect(byUntil).toHaveLength(3);
    expect(() => generateOccurrences({ pattern: "daily", start: d("2030-01-01T09:00Z") })).toThrow(HttpError);
    expect(() => generateOccurrences({ pattern: "daily", start: d("2030-01-01T09:00Z"), count: 1, until: d("2030-02-01T09:00Z") })).toThrow(HttpError);
    expect(() => generateOccurrences({ pattern: "daily", start: d("2030-01-05T09:00Z"), until: d("2030-01-01T09:00Z") })).toThrow(HttpError);
    expect(() => generateOccurrences({ pattern: "daily", start: d("2030-01-01T09:00Z"), count: -1 })).toThrow(HttpError);
  });
});

// ─── Availability + suggest-slots (Req 14.1) ──────────────────────────────────

describe("availability & slots", () => {
  const range: Interval = { start: d("2030-01-01T09:00Z"), end: d("2030-01-01T17:00Z") };

  it("mergeIntervals: merges overlapping/adjacent, drops empties", () => {
    const merged = mergeIntervals([
      { start: d("2030-01-01T09:00Z"), end: d("2030-01-01T10:00Z") },
      { start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") },
      { start: d("2030-01-01T12:00Z"), end: d("2030-01-01T12:00Z") },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.end.toISOString()).toBe("2030-01-01T11:00:00.000Z");
  });

  it("computeAvailability: complement of busy, filtered by minDuration", () => {
    const busy = [{ start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") }];
    const free = computeAvailability(busy, range);
    expect(free).toHaveLength(2);
    const longOnly = computeAvailability(busy, range, { minDurationMinutes: 120 });
    // 09:00-10:00 window (60m) dropped; 11:00-17:00 (360m) kept.
    expect(longOnly).toHaveLength(1);
  });

  it("suggestSlots: lays out non-overlapping slots and validates input", () => {
    const busy = [{ start: d("2030-01-01T10:00Z"), end: d("2030-01-01T11:00Z") }];
    const slots = suggestSlots(busy, range, 60);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(intervalsOverlap(s.start, s.end, busy[0]!.start, busy[0]!.end)).toBe(false);
    }
    expect(suggestSlots(busy, range, 60, { limit: 2 })).toHaveLength(2);
    expect(() => suggestSlots(busy, range, 0)).toThrow(HttpError);
  });
});

// ─── ICS (Req 14.7) ────────────────────────────────────────────────────────

describe("ICS generate/parse", () => {
  it("formatIcsUtc / parseIcsUtc round-trip", () => {
    const s = formatIcsUtc(d("2030-01-01T09:05:07Z"));
    expect(s).toBe("20300101T090507Z");
    expect(parseIcsUtc(s).toISOString()).toBe("2030-01-01T09:05:07.000Z");
    expect(() => parseIcsUtc("garbage")).toThrow(HttpError);
    expect(() => formatIcsUtc(new Date("nope"))).toThrow(HttpError);
  });

  it("generateIcs → parseIcs recovers every field (with escaping + folding)", () => {
    const longSummary = "Quarterly Finance Committee review; budget, audit, and compliance — " + "x".repeat(80);
    const ics = generateIcs(
      [
        {
          uid: "evt-1@civitas",
          start: d("2030-01-01T09:00:00Z"),
          end: d("2030-01-01T10:00:00Z"),
          summary: longSummary,
          description: "line1\nline2; with, specials",
          location: "Board Room, 2nd floor",
          url: "https://vc.example/join",
          organizerEmail: "sec@example.gov",
          sequence: 2,
        },
      ],
      { calName: "CivitasOne" },
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    const parsed = parseIcs(ics);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.uid).toBe("evt-1@civitas");
    expect(parsed[0]!.summary).toBe(longSummary);
    expect(parsed[0]!.description).toBe("line1\nline2; with, specials");
    expect(parsed[0]!.location).toBe("Board Room, 2nd floor");
    expect(parsed[0]!.organizerEmail).toBe("sec@example.gov");
    expect(parsed[0]!.sequence).toBe(2);
    expect(parsed[0]!.start.toISOString()).toBe("2030-01-01T09:00:00.000Z");
  });

  it("generateIcs rejects a missing uid; parseIcs rejects an incomplete VEVENT", () => {
    expect(() => generateIcs([{ uid: "", start: d("2030-01-01T09:00Z"), end: d("2030-01-01T10:00Z"), summary: "x" }])).toThrow(HttpError);
    const incomplete = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    expect(() => parseIcs(incomplete)).toThrow(HttpError);
  });
});
