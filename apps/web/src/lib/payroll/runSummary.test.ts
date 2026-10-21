import { describe, it, expect } from "vitest";
import { latestPaidRun, summariseRunStatuses } from "./runSummary";

type R = { id: string; payPeriod: string; status: "draft" | "processing" | "completed" | "paid" | "disbursed" | "failed"; runDate?: string };
const run = (id: string, payPeriod: string, status: R["status"], runDate?: string): R => ({ id, payPeriod, status, ...(runDate ? { runDate } : {}) });

describe("summariseRunStatuses (GAP-PAYROLL-HOME-04)", () => {
  it("splits runs into paid / in progress / awaiting disbursement / failed that always sum to the total", () => {
    const runs = [
      run("1", "2026-04", "paid"),
      run("2", "2026-05", "paid"),
      run("3", "2026-06", "completed"),
      run("4", "2026-07", "draft"),
      run("5", "2026-07", "processing"),
      run("6", "2026-08", "failed"),
    ];
    const s = summariseRunStatuses(runs);
    expect(s).toEqual({ total: 6, paid: 2, inProgress: 2, awaitingDisbursement: 1, failed: 1 });
    expect(s.paid + s.inProgress + s.awaitingDisbursement + s.failed).toBe(s.total);
  });

  it("'completed' (approved, money not moved) is awaiting disbursement and is NOT counted as paid", () => {
    const s = summariseRunStatuses([run("1", "2026-09", "completed")]);
    expect(s.paid).toBe(0);
    expect(s.awaitingDisbursement).toBe(1);
  });

  it("an unknown future status falls into the neutral bucket instead of vanishing from the counts", () => {
    const s = summariseRunStatuses([{ status: "on_hold" as never }, run("2", "2026-09", "paid")]);
    expect(s).toEqual({ total: 2, paid: 1, inProgress: 1, awaitingDisbursement: 0, failed: 0 });
  });

  it("an empty list is all zeros", () => {
    expect(summariseRunStatuses([])).toEqual({ total: 0, paid: 0, inProgress: 0, awaitingDisbursement: 0, failed: 0 });
  });
});

describe("latestPaidRun (GAP-PAYROLL-HOME-03)", () => {
  it("picks the single most recent PAID period, not an unpaid later one", () => {
    const picked = latestPaidRun([
      run("a", "2026-07", "paid"),
      run("b", "2026-08", "paid"),
      run("c", "2026-09", "completed"),
      run("d", "2026-10", "failed"),
    ]);
    expect(picked?.id).toBe("b");
  });

  it("is deterministic for two paid runs in the same period: the later run date wins, then the larger id", () => {
    expect(latestPaidRun([run("a", "2026-08", "paid", "2026-08-31"), run("b", "2026-08", "paid", "2026-09-02")])?.id).toBe("b");
    expect(latestPaidRun([run("b", "2026-08", "paid", "2026-09-02"), run("a", "2026-08", "paid", "2026-08-31")])?.id).toBe("b");
    expect(latestPaidRun([run("a", "2026-08", "paid", "2026-09-02"), run("b", "2026-08", "paid", "2026-09-02")])?.id).toBe("b");
  });

  it("is null when nothing has been paid", () => {
    expect(latestPaidRun([run("a", "2026-08", "completed")])).toBeNull();
    expect(latestPaidRun([])).toBeNull();
  });
});
