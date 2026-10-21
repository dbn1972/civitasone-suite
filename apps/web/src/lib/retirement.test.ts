import { describe, it, expect } from "vitest";
import { isUpcoming, isOverdue, sortByDateAsc, partitionRetirements, todayDateOnly } from "./retirement";

// 2026-06-15 11:30 IST
const NOW = new Date("2026-06-15T06:00:00Z");

type Row = { id: string; superannuationDate: string; status?: string };
const row = (id: string, superannuationDate: string, status = "initiated"): Row => ({ id, superannuationDate, status });

describe("todayDateOnly", () => {
  it("is the Asia/Kolkata calendar date, not the UTC date", () => {
    // 2026-03-01T19:00Z is 00:30 IST on 2 March.
    expect(todayDateOnly(new Date("2026-03-01T19:00:00Z"))).toBe("2026-03-02");
    expect(todayDateOnly(new Date("2026-03-01T18:29:00Z"))).toBe("2026-03-01");
  });
});

describe("isUpcoming (GAP-HR-RETIREMENT-05)", () => {
  it("counts an effective date of today (a date-only value is not 'before now' at 11:30)", () => {
    expect(isUpcoming(row("a", "2026-06-15"), NOW)).toBe(true);
  });

  it("includes the last day of the 6-month window and excludes the day after", () => {
    expect(isUpcoming(row("a", "2026-12-15"), NOW)).toBe(true);
    expect(isUpcoming(row("b", "2026-12-16"), NOW)).toBe(false);
  });

  it("clamps the window end to the last day of a shorter month (31 Aug + 6 months = end Feb)", () => {
    const aug31 = new Date("2026-08-31T06:00:00Z");
    expect(isUpcoming(row("a", "2027-02-28"), aug31)).toBe(true);
    expect(isUpcoming(row("b", "2027-03-01"), aug31)).toBe(false);
  });

  it("excludes yesterday, and ignores a row with no date", () => {
    expect(isUpcoming(row("a", "2026-06-14"), NOW)).toBe(false);
    expect(isUpcoming({ superannuationDate: "" }, NOW)).toBe(false);
  });

  it("uses the IST date at the 00:30 IST boundary: a date of 'IST today' is upcoming, 'IST yesterday' is not", () => {
    const justAfterIstMidnight = new Date("2026-03-01T19:00:00Z"); // UTC date is still 1 March
    expect(isUpcoming(row("a", "2026-03-02"), justAfterIstMidnight)).toBe(true);
    expect(isUpcoming(row("b", "2026-03-01"), justAfterIstMidnight)).toBe(false);
  });
});

describe("isOverdue (GAP-HR-RETIREMENT-05)", () => {
  it("an effective date of yesterday with status initiated is overdue", () => {
    expect(isOverdue(row("a", "2026-06-14", "initiated"), NOW)).toBe(true);
  });

  it("today is NOT overdue (it is upcoming/due now)", () => {
    expect(isOverdue(row("a", "2026-06-15", "initiated"), NOW)).toBe(false);
  });

  it("a completed or cancelled past row is excluded", () => {
    expect(isOverdue(row("a", "2026-01-01", "completed"), NOW)).toBe(false);
    expect(isOverdue(row("b", "2026-01-01", "cancelled"), NOW)).toBe(false);
  });

  it("a row with no status is treated as still initiated", () => {
    expect(isOverdue({ superannuationDate: "2026-06-01" }, NOW)).toBe(true);
  });
});

describe("partitionRetirements", () => {
  const rows: Row[] = [
    row("future-late", "2026-11-30"),
    row("today", "2026-06-15"),
    row("old-overdue", "2026-03-01"),
    row("recent-overdue", "2026-06-10"),
    row("done-past", "2026-02-01", "completed"),
    row("beyond-window", "2027-01-31"),
    row("future-soon", "2026-07-01"),
  ];

  it("splits into overdue (oldest first) and upcoming (soonest first), dropping completed and out-of-window rows", () => {
    const { overdue, upcoming, cases } = partitionRetirements(rows, NOW);
    expect(overdue.map((r) => r.id)).toEqual(["old-overdue", "recent-overdue"]);
    expect(upcoming.map((r) => r.id)).toEqual(["today", "future-soon", "future-late"]);
    expect(cases.map((r) => r.id)).toEqual(["old-overdue", "recent-overdue", "today", "future-soon", "future-late"]);
  });

  it("cases is exactly overdue + upcoming, so a KPI built from either part can never disagree with the cards", () => {
    const { overdue, upcoming, cases } = partitionRetirements(rows, NOW);
    expect(cases).toHaveLength(overdue.length + upcoming.length);
  });

  it("does not mutate its input", () => {
    const copy = rows.map((r) => r.id);
    partitionRetirements(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("sortByDateAsc", () => {
  it("orders by the date-only part ascending", () => {
    expect(sortByDateAsc([row("b", "2026-02-01T00:00:00Z"), row("a", "2026-01-01")]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
