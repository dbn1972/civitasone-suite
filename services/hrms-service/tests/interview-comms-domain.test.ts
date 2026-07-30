/**
 * R-RA-0142 — interview comms lifecycle domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  commsEnabled, resolveDispatch, buildCommMessage, requiresSchedule, INTERVIEW_COMM_TYPES,
  canCommunicate, isValidCalendarDate, isValidTime,
} from "../src/modules/recruitment/interview-comms.js";

describe("commsEnabled", () => {
  it("is off unless the flag is exactly 'true'", () => {
    expect(commsEnabled({})).toBe(false);
    expect(commsEnabled({ FEATURE_INTERVIEW_COMMS_ENABLED: "false" })).toBe(false);
    expect(commsEnabled({ FEATURE_INTERVIEW_COMMS_ENABLED: "1" })).toBe(false);
    expect(commsEnabled({ FEATURE_INTERVIEW_COMMS_ENABLED: "true" })).toBe(true);
  });
});

describe("resolveDispatch", () => {
  it("forces a stub when disabled (no real send)", () => {
    expect(resolveDispatch(false, "email")).toEqual({ channel: "stub", status: "stubbed" });
    expect(resolveDispatch(false, undefined)).toEqual({ channel: "stub", status: "stubbed" });
  });
  it("queues on the requested channel when enabled (defaulting to email)", () => {
    expect(resolveDispatch(true, "sms")).toEqual({ channel: "sms", status: "queued" });
    expect(resolveDispatch(true, undefined)).toEqual({ channel: "email", status: "queued" });
    expect(resolveDispatch(true, "stub")).toEqual({ channel: "email", status: "queued" }); // never queue on "stub"
  });
});

describe("buildCommMessage", () => {
  it("produces candidate-facing text per type with schedule context", () => {
    expect(buildCommMessage("invite", { scheduledDate: "2026-08-01", scheduledTime: "10:00" })).toContain("invited");
    expect(buildCommMessage("reminder", { scheduledDate: "2026-08-01" })).toContain("Reminder");
    expect(buildCommMessage("reschedule", { scheduledDate: "2026-08-02", scheduledTime: "11:30" })).toContain("rescheduled");
    expect(buildCommMessage("cancel", {})).toContain("cancelled");
  });
});

describe("requiresSchedule", () => {
  it("is true only for reschedule", () => {
    expect(requiresSchedule("reschedule")).toBe(true);
    for (const t of INTERVIEW_COMM_TYPES.filter((x) => x !== "reschedule")) expect(requiresSchedule(t)).toBe(false);
  });
});

describe("canCommunicate", () => {
  it("allows only scheduled/rescheduled states", () => {
    expect(canCommunicate("scheduled")).toBe(true);
    expect(canCommunicate("rescheduled")).toBe(true);
    for (const s of ["cancelled", "completed", "selected", "rejected"]) expect(canCommunicate(s)).toBe(false);
  });
});

describe("isValidCalendarDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidCalendarDate("2026-08-01")).toBe(true);
    expect(isValidCalendarDate("2026-02-29")).toBe(false); // 2026 not a leap year
    expect(isValidCalendarDate("2026-13-45")).toBe(false);
    expect(isValidCalendarDate("2026-8-1")).toBe(false);
    expect(isValidCalendarDate("not-a-date")).toBe(false);
  });
});

describe("isValidTime", () => {
  it("accepts real 24h times and rejects impossible ones", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("25:99")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
  });
});
