import { describe, it, expect } from "vitest";
import { isReviewDue, isWeedingDue, dueKind, todayInIST, thirtyDaysFromNowIST } from "./recordDue";

describe("todayInIST (GAP-KNOWLEDGE-RECORDS-07)", () => {
  it("returns YYYY-MM-DD format", () => {
    const result = todayInIST(new Date("2026-10-06T20:00:00Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("at 20:00 UTC (01:30 IST next day) advances the date", () => {
    // 2026-10-06 20:00 UTC = 2026-10-07 01:30 IST
    const result = todayInIST(new Date("2026-10-06T20:00:00Z"));
    expect(result).toBe("2026-10-07");
  });

  it("at 05:00 UTC (10:30 IST same day) stays on same date", () => {
    const result = todayInIST(new Date("2026-10-06T05:00:00Z"));
    expect(result).toBe("2026-10-06");
  });
});

describe("thirtyDaysFromNowIST", () => {
  it("adds 30 days to IST date", () => {
    const result = thirtyDaysFromNowIST(new Date("2026-10-01T05:00:00Z"));
    expect(result).toBe("2026-10-31");
  });
});

describe("isReviewDue (GAP-KNOWLEDGE-RECORDS-02)", () => {
  const now = new Date("2026-10-06T05:00:00Z"); // IST date = 2026-10-06

  it("true for active record with due date within 30 days", () => {
    expect(isReviewDue({ status: "active", disposalDueDate: "2026-10-20" }, now)).toBe(true);
  });

  it("true for active record due today", () => {
    expect(isReviewDue({ status: "active", disposalDueDate: "2026-10-06" }, now)).toBe(true);
  });

  it("false for disposed record even with past due date", () => {
    expect(isReviewDue({ status: "disposed", disposalDueDate: "2026-09-01" }, now)).toBe(false);
  });

  it("false for active record without due date", () => {
    expect(isReviewDue({ status: "active", disposalDueDate: null }, now)).toBe(false);
  });

  it("false for active record with due date beyond 30 days", () => {
    expect(isReviewDue({ status: "active", disposalDueDate: "2027-01-01" }, now)).toBe(false);
  });
});

describe("isWeedingDue (GAP-KNOWLEDGE-RECORDS-02)", () => {
  const now = new Date("2026-10-06T05:00:00Z");

  it("true for active record with past due date", () => {
    expect(isWeedingDue({ status: "active", disposalDueDate: "2026-09-01" }, now)).toBe(true);
  });

  it("false for active record due today (not yet overdue)", () => {
    expect(isWeedingDue({ status: "active", disposalDueDate: "2026-10-06" }, now)).toBe(false);
  });

  it("false for disposed record (already destroyed)", () => {
    expect(isWeedingDue({ status: "disposed", disposalDueDate: "2026-09-01" }, now)).toBe(false);
  });
});

describe("dueKind", () => {
  const now = new Date("2026-10-06T05:00:00Z");

  it("weeding for overdue active", () => {
    expect(dueKind({ status: "active", disposalDueDate: "2026-09-01" }, now)).toBe("weeding");
  });

  it("review for upcoming active", () => {
    expect(dueKind({ status: "active", disposalDueDate: "2026-10-30" }, now)).toBe("review");
  });

  it("none for future active", () => {
    expect(dueKind({ status: "active", disposalDueDate: "2027-06-01" }, now)).toBe("none");
  });

  it("none for disposed", () => {
    expect(dueKind({ status: "disposed", disposalDueDate: "2026-09-01" }, now)).toBe("none");
  });
});
