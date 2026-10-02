import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { advanceStats, billStats, guaranteeStats, schemeStats, ucStats } from "./expenditureStats";

describe("advanceStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T06:00:00.000Z")); // 11:30 IST
  });
  afterEach(() => vi.useRealTimers());

  const adv = (status: string, dueDate: string | undefined, balance = "100", adjustedAmount = "0") => ({ status, dueDate, balance, adjustedAmount });

  it("counts only advances due MORE than 90 days ago as Overdue > 90d", () => {
    const s = advanceStats([
      adv("active", "2026-06-24"), // 100 days ago -> counts
      adv("overdue", "2026-09-02"), // 30 days ago, status overdue -> does NOT count
      adv("active", "2026-07-04"), // exactly 90 days ago -> not > 90
    ]);
    expect(s.overdue90).toBe(1);
  });
  it("does not count a fully recovered advance as overdue", () => {
    expect(advanceStats([adv("adjusted", "2026-01-01", "0"), adv("active", "2026-01-01", "0")]).overdue90).toBe(0);
  });
  it("sums outstanding and settled in BigInt (no string concatenation, no precision loss)", () => {
    const s = advanceStats([
      adv("active", undefined, "9007199254740993"),
      adv("adjusted", undefined, "0", "9007199254740993"),
      adv("adjusted", undefined, "0", "7"),
    ]);
    expect(s.outstanding).toBe(9007199254740993n);
    expect(s.settledAllTime).toBe(9007199254741000n);
    expect(s.open).toBe(1);
  });
});

describe("billStats", () => {
  it("pipeline includes passed-unpaid and on_hold bills; paid is a separate all-time sum", () => {
    const s = billStats([
      { status: "pending", amount: "100" },
      { status: "passed", amount: "1000" },
      { status: "on_hold", amount: "10000" },
      { status: "paid", amount: "50" },
      { status: "paid", amount: "25" },
      { status: "rejected", amount: "999" },
    ]);
    expect(s.pipelineValue).toBe(11100n);
    expect(s.paidAllTime).toBe(75n);
    expect(s.inProcess).toBe(3);
  });
});

describe("guaranteeStats / schemeStats", () => {
  it("other = neither active nor released", () => {
    const g = guaranteeStats([{ status: "active" }, { status: "Released" }, { status: "expired" }, { status: "invoked" }]);
    expect(g).toMatchObject({ total: 4, active: 1, released: 1, otherStatus: 2 });
  });
  it("scheme other = neither active nor completed", () => {
    const s = schemeStats([{ status: "active" }, { status: "completed" }, { status: "on_hold" }, { status: "cancelled" }]);
    expect(s.otherStatus).toBe(2);
  });
});

describe("ucStats", () => {
  it("a rejected UC is not 'pending submission'", () => {
    const s = ucStats([
      { status: "pending", amount: "10" },
      { status: "rejected", amount: "20" },
      { status: "submitted", amount: "30" },
    ]);
    expect(s).toMatchObject({ pending: 1, rejected: 1, submittedVerified: 1, covered: 60n });
  });
});
