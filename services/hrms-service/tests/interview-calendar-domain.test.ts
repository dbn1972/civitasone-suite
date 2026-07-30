/**
 * X04 / R-RA-0140 — interview calendar (.ics) domain (pure).
 */
import { describe, it, expect } from "vitest";
import { buildIcs, toIcsStamp, calendarSyncEnabled } from "../src/modules/recruitment/interview-calendar.js";

describe("toIcsStamp", () => {
  it("formats YYYY-MM-DD + HH:MM as UTC basic iCalendar", () => {
    expect(toIcsStamp("2026-08-01", "10:30")).toBe("20260801T103000Z");
  });
});

describe("buildIcs", () => {
  const base = { uid: "iv-1@x", title: "Interview — technical", date: "2026-08-01", time: "10:00", durationMinutes: 60 };
  const NOW = Date.parse("2026-07-20T00:00:00Z");

  it("produces a valid single-event VCALENDAR with DTSTART/DTEND", () => {
    const ics = buildIcs(base, NOW);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:iv-1@x");
    expect(ics).toContain("DTSTART:20260801T100000Z");
    expect(ics).toContain("DTEND:20260801T110000Z"); // +60 min
    expect(ics).toContain("DTSTAMP:20260720T000000Z");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("uses CRLF line endings (RFC 5545)", () => {
    expect(buildIcs(base, NOW).includes("\r\n")).toBe(true);
  });

  it("escapes special characters in text fields", () => {
    const ics = buildIcs({ ...base, title: "Interview; round, one", location: "Room 1, Block A" }, NOW);
    expect(ics).toContain("SUMMARY:Interview\\; round\\, one");
    expect(ics).toContain("LOCATION:Room 1\\, Block A");
  });

  it("omits optional lines when not provided", () => {
    const ics = buildIcs(base, NOW);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("ORGANIZER:");
  });
});

describe("calendarSyncEnabled", () => {
  it("defaults off unless flag is exactly 'true'", () => {
    expect(calendarSyncEnabled({})).toBe(false);
    expect(calendarSyncEnabled({ FEATURE_CALENDAR_SYNC_ENABLED: "true" })).toBe(true);
  });
});
