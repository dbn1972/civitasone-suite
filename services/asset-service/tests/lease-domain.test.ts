/** GAP-ASSETS-LEASES-07: pure lease discounting + amortisation schedule. */
import { describe, it, expect } from "vitest";
import { buildLeaseSchedule, schedulePeriodCount, periodEndDate } from "../src/modules/enterprise/lease-domain.js";

describe("schedulePeriodCount / periodEndDate", () => {
  it("counts whole periods for a 12-month lease at each frequency", () => {
    expect(schedulePeriodCount("2026-04-01", "2027-03-31", "monthly")).toBe(12);
    expect(schedulePeriodCount("2026-04-01", "2027-03-31", "quarterly")).toBe(4);
    expect(schedulePeriodCount("2026-04-01", "2027-03-31", "annual")).toBe(1);
    expect(schedulePeriodCount("2026-04-01", "2031-03-31", "monthly")).toBe(60);
  });
  it("puts each payment on the last day of its period, clamping short months", () => {
    expect(periodEndDate("2026-04-01", 1)).toBe("2026-04-30");
    expect(periodEndDate("2026-04-01", 12)).toBe("2027-03-31");
    expect(periodEndDate("2026-01-31", 1)).toBe("2026-02-27");
  });
});

describe("buildLeaseSchedule", () => {
  const input = { leaseStart: "2026-04-01", leaseEnd: "2027-03-31", paymentMinor: 1_000_000n, ibrBps: 800, frequency: "monthly" as const };

  it("liability = present value of 12 x 10,000 at 8% a year (monthly in arrears)", () => {
    const s = buildLeaseSchedule(input);
    // PV of an ordinary annuity: P * (1 - (1+r)^-n) / r with r = 0.08/12, n = 12  => 114,957.9...
    const r = 0.08 / 12;
    const expected = Math.round(1_000_000 * (1 - Math.pow(1 + r, -12)) / r);
    expect(s.liabilityMinor).toBe(BigInt(expected));
    expect(s.rows).toHaveLength(12);
  });

  it("amortises to exactly zero and principal + interest reconcile to the total payments", () => {
    const s = buildLeaseSchedule(input);
    const last = s.rows.at(-1)!;
    expect(last.closingMinor).toBe(0n);
    const principal = s.rows.reduce((a, r) => a + r.principalMinor, 0n);
    const interest = s.rows.reduce((a, r) => a + r.interestMinor, 0n);
    const paid = s.rows.reduce((a, r) => a + r.paymentMinor, 0n);
    expect(principal).toBe(s.liabilityMinor);
    expect(interest).toBe(s.totalInterestMinor);
    expect(principal + interest).toBe(paid);
    expect(paid).toBe(12_000_000n);
    // each row links to the next: closing(k) === opening(k+1)
    s.rows.slice(0, -1).forEach((r, i) => expect(r.closingMinor).toBe(s.rows[i + 1]!.openingMinor));
    // interest declines as the balance amortises
    expect(s.rows[0]!.interestMinor).toBeGreaterThan(s.rows[11]!.interestMinor);
  });

  it("a 0% rate is undiscounted: liability = sum of payments, no interest", () => {
    const s = buildLeaseSchedule({ ...input, ibrBps: 0 });
    expect(s.liabilityMinor).toBe(12_000_000n);
    expect(s.totalInterestMinor).toBe(0n);
    expect(s.rows.at(-1)!.closingMinor).toBe(0n);
  });

  it("throws instead of clamping when rounding drift would leave the schedule unable to close at 0", () => {
    // tiny payment at a 100% rate: the last period's plug interest goes negative; the old code clamped it to 0 and left closing > 0
    expect(() => buildLeaseSchedule({ ...input, paymentMinor: 3n, ibrBps: 10_000 })).toThrow(/do not amortise/);
    // every schedule that does build always closes at exactly 0
    for (const [pay, bps] of [[1n, 0], [7n, 800], [100n, 1200], [123_457n, 950], [1_000_000n, 2500]] as const) {
      try {
        const s = buildLeaseSchedule({ ...input, paymentMinor: pay, ibrBps: bps });
        expect(s.rows.at(-1)!.closingMinor).toBe(0n);
      } catch (e) {
        expect((e as Error).message).toMatch(/do not amortise/);
      }
    }
  });

  it("rejects non-positive payments, bad rates and over-long terms", () => {
    expect(() => buildLeaseSchedule({ ...input, paymentMinor: 0n })).toThrow(/positive/);
    expect(() => buildLeaseSchedule({ ...input, ibrBps: 10_001 })).toThrow(/ibrBps/);
    expect(() => buildLeaseSchedule({ ...input, leaseEnd: "2099-03-31" })).toThrow(/exceeds/);
  });
});
