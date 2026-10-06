import { describe, it, expect } from "vitest";
import {
  istLocalToIso,
  meetingPillStatus,
  meetingStatusLabel,
} from "./format";

describe("istLocalToIso (GAP-MEETING-MEETINGS-NEW-02)", () => {
  it("interprets a datetime-local value as IST (+05:30) and returns the UTC instant", () => {
    expect(istLocalToIso("2026-09-01T10:00")).toBe("2026-09-01T04:30:00.000Z");
  });

  it("is independent of the host TZ (fixed +05:30 offset, no DST)", () => {
    const prev = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(istLocalToIso("2027-01-15T10:00")).toBe("2027-01-15T04:30:00.000Z");
      process.env.TZ = "Pacific/Kiritimati";
      expect(istLocalToIso("2027-01-15T10:00")).toBe("2027-01-15T04:30:00.000Z");
    } finally {
      process.env.TZ = prev;
    }
  });

  it("returns null for empty or malformed input", () => {
    expect(istLocalToIso("")).toBeNull();
    expect(istLocalToIso(null)).toBeNull();
    expect(istLocalToIso("not-a-date")).toBeNull();
  });
});

describe("meetingStatusLabel (GAP-MEETING-MEETINGS-04)", () => {
  it("gives cancelled and archived distinct labels", () => {
    expect(meetingStatusLabel("cancelled")).toBe("Cancelled");
    expect(meetingStatusLabel("archived")).toBe("Archived");
    expect(meetingStatusLabel("cancelled")).not.toBe(meetingStatusLabel("archived"));
  });

  it("falls back to humanize for an unknown status", () => {
    expect(meetingStatusLabel("some_future_state")).toBe("Some future state");
  });
});

describe("meetingPillStatus (GAP-MEETING-MEETINGS-04)", () => {
  it("maps cancelled and archived to distinct variants (no longer both 'closed')", () => {
    expect(meetingPillStatus("cancelled")).not.toBe(meetingPillStatus("archived"));
  });
});
