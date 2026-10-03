import { describe, it, expect } from "vitest";
import { shiftToForm, toShiftPayload, toHhmm } from "./shiftForm";

describe("shift form mapping (GAP-HR-SHIFTS-01)", () => {
  it("defaults a new shift to the DoPT general hours", () => {
    expect(shiftToForm(null)).toEqual({ name: "", startTime: "09:00", endTime: "17:30", graceMins: "15" });
  });
  it("trims postgres HH:MM:SS to HH:MM when editing", () => {
    expect(toHhmm("22:00:00")).toBe("22:00");
    expect(shiftToForm({ id: "1", name: "Night", startTime: "22:00:00", endTime: "06:00:00", graceMinutes: 10 }))
      .toEqual({ name: "Night", startTime: "22:00", endTime: "06:00", graceMins: "10" });
  });
  it("accepts a night shift that crosses midnight", () => {
    expect(toShiftPayload({ name: " Night ", startTime: "22:00", endTime: "06:00", graceMins: "15" }))
      .toEqual({ ok: true, payload: { name: "Night", startTime: "22:00", endTime: "06:00", graceMins: 15 } });
  });
  it("rejects blank name, bad times, equal times and out-of-range grace", () => {
    expect(toShiftPayload({ name: "  ", startTime: "09:00", endTime: "17:00", graceMins: "0" })).toEqual({ ok: false, reason: "name" });
    expect(toShiftPayload({ name: "A", startTime: "9:00", endTime: "17:00", graceMins: "0" })).toEqual({ ok: false, reason: "time" });
    expect(toShiftPayload({ name: "A", startTime: "09:00", endTime: "09:00", graceMins: "0" })).toEqual({ ok: false, reason: "same" });
    expect(toShiftPayload({ name: "A", startTime: "09:00", endTime: "17:00", graceMins: "241" })).toEqual({ ok: false, reason: "grace" });
    expect(toShiftPayload({ name: "A", startTime: "09:00", endTime: "17:00", graceMins: "-1" })).toEqual({ ok: false, reason: "grace" });
    expect(toShiftPayload({ name: "A", startTime: "09:00", endTime: "17:00", graceMins: "1.5" })).toEqual({ ok: false, reason: "grace" });
  });
  it("an empty grace field means 0", () => {
    expect(toShiftPayload({ name: "A", startTime: "09:00", endTime: "17:00", graceMins: "" }))
      .toMatchObject({ ok: true, payload: { graceMins: 0 } });
  });
});
