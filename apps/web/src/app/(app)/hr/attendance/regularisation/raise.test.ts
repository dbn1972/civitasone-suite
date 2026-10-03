import { describe, it, expect } from "vitest";
import { istToday, validateRegularisationForm, friendlyRegularisationError } from "./raise";

const OK = { employeeId: "e1", date: "2026-02-10", requestedStatus: "present" as const, reason: "Biometric down" };

describe("validateRegularisationForm", () => {
  it("accepts a valid request", () => {
    expect(validateRegularisationForm(OK, { needEmployee: true, today: "2026-02-11" })).toEqual({});
  });
  it("blocks a future date (client-side, matching the server)", () => {
    expect(validateRegularisationForm({ ...OK, date: "2026-02-12" }, { needEmployee: true, today: "2026-02-11" }).date).toBeDefined();
    expect(validateRegularisationForm({ ...OK, date: "2026-02-11" }, { needEmployee: true, today: "2026-02-11" })).toEqual({});
  });
  it("requires a reason and a date", () => {
    const e = validateRegularisationForm({ ...OK, date: "", reason: "  " }, { needEmployee: false, today: "2026-02-11" });
    expect(e.date).toBeDefined();
    expect(e.reason).toBeDefined();
  });
  it("only demands an employee when the caller picks one (employees raise for themselves)", () => {
    expect(validateRegularisationForm({ ...OK, employeeId: null }, { needEmployee: false, today: "2026-02-11" })).toEqual({});
    expect(validateRegularisationForm({ ...OK, employeeId: null }, { needEmployee: true, today: "2026-02-11" }).employee).toBeDefined();
  });
});

describe("istToday", () => {
  it("is the Indian date (31 Dec 20:00 UTC is already 1 Jan in IST)", () => {
    expect(istToday(Date.parse("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("friendlyRegularisationError", () => {
  const m = { noRecord: "no record", locked: "locked", notYourReport: "not yours" };
  it("maps the actionable backend codes", () => {
    expect(friendlyRegularisationError("ATTENDANCE_RECORD_NOT_FOUND", m)).toBe("no record");
    expect(friendlyRegularisationError("ATTENDANCE_LOCKED", m)).toBe("locked");
    expect(friendlyRegularisationError("NOT_YOUR_REPORT", m)).toBe("not yours");
  });
  it("falls through for anything else", () => {
    expect(friendlyRegularisationError("VALIDATION_FAILED", m)).toBeNull();
    expect(friendlyRegularisationError(null, m)).toBeNull();
  });
});
