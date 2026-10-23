import { describe, it, expect } from "vitest";
import { latestPaidPeriodTotals, latestPaidRun, summariseRunStatuses } from "./runSummary";

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

describe("latestPaidPeriodTotals (GAP-PAYROLL-HOME-03)", () => {
  type P = { id: string; payPeriod: string; status: R["status"]; employeeCount: number; grossMinor?: string };
  const p = (id: string, payPeriod: string, status: R["status"], employeeCount: number, grossMinor?: string): P =>
    ({ id, payPeriod, status, employeeCount, ...(grossMinor === undefined ? {} : { grossMinor }) });

  it("adds up the paid runs of the latest paid period only (pay-group runs), exact in paise", () => {
    const t = latestPaidPeriodTotals([
      p("a", "2026-08", "paid", 100, "50000000"),
      p("b", "2026-09", "paid", 60, "30000001"),
      p("c", "2026-09", "paid", 40, "20000002"),
      p("d", "2026-09", "completed", 7, "999"),
      p("e", "2026-10", "failed", 3, "888"),
    ]);
    expect(t).toEqual({ payPeriod: "2026-09", runCount: 2, employeeCount: 100, grossMinor: 50000003n });
  });

  it("two single paid runs of 100 in different months still give 100 for the latest month, not 200", () => {
    const t = latestPaidPeriodTotals([p("a", "2026-07", "paid", 100, "50000000"), p("b", "2026-08", "paid", 100, "50000000")]);
    expect(t).toEqual({ payPeriod: "2026-08", runCount: 1, employeeCount: 100, grossMinor: 50000000n });
  });

  it("treats 'disbursed' as paid and ignores unpaid statuses", () => {
    expect(latestPaidPeriodTotals([p("a", "2026-08", "disbursed", 5, "100"), p("b", "2026-09", "draft", 9, "900")]))
      .toEqual({ payPeriod: "2026-08", runCount: 1, employeeCount: 5, grossMinor: 100n });
  });

  it("an unknown paise total on any paid run of the period makes the gross unknown (null), not a partial sum", () => {
    const t = latestPaidPeriodTotals([p("a", "2026-09", "paid", 60, "30000000"), p("b", "2026-09", "paid", 40)]);
    expect(t).toEqual({ payPeriod: "2026-09", runCount: 2, employeeCount: 100, grossMinor: null });
    expect(latestPaidPeriodTotals([p("a", "2026-09", "paid", 60, "12.5")])?.grossMinor).toBeNull();
  });

  it("is null when nothing has been paid", () => {
    expect(latestPaidPeriodTotals([p("a", "2026-08", "completed", 1, "1")])).toBeNull();
    expect(latestPaidPeriodTotals([])).toBeNull();
  });

  // The reviewer's finding: GET /v1/payroll/runs also lists supplementary, arrears and
  // pensioner runs, which coexist with the regular run of the month.
  describe("run types (regular vs arrears / supplementary / pensioner)", () => {
    type RT = "regular" | "supplementary" | "arrears" | "pensioner";
    const q = (id: string, payPeriod: string, status: R["status"], runType: RT | undefined, employeeCount: number, grossMinor: string) =>
      ({ id, payPeriod, status, employeeCount, grossMinor, ...(runType ? { runType } : {}) });

    it("regular 100 + a paid arrears run of 5 in the same period shows a headcount of 100, not 105", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("arr", "2026-09", "paid", "arrears", 5, "250000"),
      ]);
      expect(t?.employeeCount).toBe(100);
      expect(t?.payPeriod).toBe("2026-09");
    });

    it("a paid supplementary run and a paid pensioner run add no headcount either", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("sup", "2026-09", "paid", "supplementary", 7, "700000"),
        q("pen", "2026-09", "paid", "pensioner", 30, "9000000"),
      ]);
      expect(t?.employeeCount).toBe(100);
    });

    it("Total Gross covers ALL the period's paid runs (labelled 'all paid runs'): exact paise, nothing floated", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("arr", "2026-09", "paid", "arrears", 5, "250001"),
        q("sup", "2026-09", "paid", "supplementary", 7, "700002"),
        q("pen", "2026-09", "paid", "pensioner", 30, "9000003"),
      ]);
      expect(t).toEqual({ payPeriod: "2026-09", runCount: 4, employeeCount: 100, grossMinor: 59950006n });
    });

    it("several regular pay-group runs of one month still add up (60 + 40 = 100) alongside an arrears run", () => {
      const t = latestPaidPeriodTotals([
        q("g1", "2026-09", "paid", "regular", 60, "30000000"),
        q("g2", "2026-09", "paid", "regular", 40, "20000000"),
        q("arr", "2026-09", "paid", "arrears", 5, "250000"),
      ]);
      expect(t?.employeeCount).toBe(100);
      expect(t?.runCount).toBe(3);
    });

    it("an unpaid arrears run (or regular run) is not counted at all", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("arr", "2026-09", "completed", "arrears", 5, "250000"),
      ]);
      expect(t).toEqual({ payPeriod: "2026-09", runCount: 1, employeeCount: 100, grossMinor: 50000000n });
    });

    it("a run with no runType (an older payroll-service) is a regular run, so behaviour is unchanged", () => {
      const t = latestPaidPeriodTotals([q("a", "2026-09", "paid", undefined, 60, "30000000"), q("b", "2026-09", "paid", undefined, 40, "20000000")]);
      expect(t).toEqual({ payPeriod: "2026-09", runCount: 2, employeeCount: 100, grossMinor: 50000000n });
    });

    it("an unrecognised future runType is not regular, so it can never inflate the headcount", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("x", "2026-09", "paid", "bonus" as never, 9, "900000"),
      ]);
      expect(t?.employeeCount).toBe(100);
    });

    it("the period is the latest whose REGULAR payroll is paid: a paid arrears run in a later month with no paid regular run does not make the tile read 0 employees", () => {
      const t = latestPaidPeriodTotals([
        q("reg", "2026-09", "paid", "regular", 100, "50000000"),
        q("arr", "2026-10", "paid", "arrears", 5, "250000"),
        q("reg10", "2026-10", "processing", "regular", 100, "0"),
      ]);
      expect(t).toEqual({ payPeriod: "2026-09", runCount: 1, employeeCount: 100, grossMinor: 50000000n });
    });

    it("when no regular run has been paid at all, the paid money is still shown (latest period with any paid run), with a headcount of 0", () => {
      const t = latestPaidPeriodTotals([q("pen", "2026-09", "paid", "pensioner", 30, "9000000")]);
      expect(t).toEqual({ payPeriod: "2026-09", runCount: 1, employeeCount: 0, grossMinor: 9000000n });
    });
  });
});
