import { describe, it, expect, vi, afterEach } from "vitest";
import { daysLeft, computeSla, isOverdue, pendencyDays } from "./sla";

afterEach(() => {
  vi.useRealTimers();
});

// GAP-ESTAB-INBOX-03: SLA maths must be IST-calendar-day based and identical
// wherever it runs. We freeze "now" to an instant that is a different calendar
// day in UTC vs IST to prove it uses the IST day.
describe("estab SLA (IST calendar days)", () => {
  it("a file due today (IST) reads as 0 days left, not overdue, even just after IST midnight", () => {
    // 2026-03-01T19:00:00Z == 2026-03-02 00:30 IST.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z"));
    expect(daysLeft("2026-03-02")).toBe(0);
    expect(computeSla("2026-03-02")).toEqual({ label: "0d left", tone: "warn" });
  });

  it("a file due yesterday (IST) is overdue by 1 day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z")); // 2026-03-02 IST
    expect(daysLeft("2026-03-01")).toBe(-1);
    expect(computeSla("2026-03-01")).toEqual({ label: "overdue 1d", tone: "bad" });
  });

  it("a file due in a week is good", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z")); // 2026-03-02 IST
    expect(daysLeft("2026-03-09")).toBe(7);
    expect(computeSla("2026-03-09")).toEqual({ label: "7d left", tone: "good" });
  });

  it("missing due date is muted", () => {
    expect(daysLeft(undefined)).toBeNull();
    expect(computeSla(undefined)).toEqual({ label: "—", tone: "mut" });
  });
});

// GAP-ESTAB-DASHBOARD-01: unified SLA definition.
describe("isOverdue", () => {
  it("returns true for a file due yesterday that is still active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z")); // IST 2026-03-02
    expect(isOverdue({ dueDate: "2026-03-01", status: "active" })).toBe(true);
  });
  it("returns false for a file due today (IST)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z"));
    expect(isOverdue({ dueDate: "2026-03-02", status: "active" })).toBe(false);
  });
  it("returns false for an archived file even if past due", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z"));
    expect(isOverdue({ dueDate: "2026-01-01", status: "archived" })).toBe(false);
  });
  it("returns false when dueDate is missing", () => {
    expect(isOverdue({ status: "active" })).toBe(false);
  });
});

describe("pendencyDays", () => {
  it("returns positive days since creation for an active file", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z")); // IST 2026-03-02
    expect(pendencyDays({ createdDate: "2026-02-23", status: "pending" })).toBe(7);
  });
  it("returns null for '—' createdDate", () => {
    expect(pendencyDays({ createdDate: "—", status: "active" })).toBeNull();
  });
  it("returns null for disposed status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z"));
    expect(pendencyDays({ createdDate: "2026-02-01", status: "disposed" })).toBeNull();
  });
});
