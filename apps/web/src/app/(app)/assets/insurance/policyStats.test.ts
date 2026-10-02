import { describe, it, expect } from "vitest";
import { bucketPolicy, derivePolicyStats } from "./policyStats";

// GAP-ASSETS-INSURANCE-04
describe("derivePolicyStats", () => {
  const today = "2026-10-02";

  it("counts each policy in exactly one bucket (active / active past end / expired)", () => {
    const stats = derivePolicyStats(
      [
        { status: "active", endDate: "2027-12-31" },
        { status: "active", endDate: "2026-09-30" },
        { status: "expired", endDate: "2027-12-31" },
      ],
      today,
    );
    expect(stats).toEqual({ total: 3, active: 1, expiring: 0, lapsed: 2, other: 0 });
  });

  it("a policy ending today is Expiring, not Lapsed; the day after is Lapsed", () => {
    expect(bucketPolicy({ status: "active", endDate: "2026-10-02" }, today)).toBe("expiring");
    expect(bucketPolicy({ status: "active", endDate: "2026-10-01" }, today)).toBe("lapsed");
  });

  it("the 30-day window is inclusive of day 30 and exclusive of day 31", () => {
    expect(bucketPolicy({ status: "active", endDate: "2026-11-01" }, today)).toBe("expiring");
    expect(bucketPolicy({ status: "active", endDate: "2026-11-02" }, today)).toBe("active");
  });

  it("treats lapsed/cancelled statuses as lapsed and unknown statuses as Other (buckets sum to Total)", () => {
    expect(bucketPolicy({ status: "lapsed", endDate: "2030-01-01" }, today)).toBe("lapsed");
    expect(bucketPolicy({ status: "cancelled", endDate: "2030-01-01" }, today)).toBe("lapsed");
    expect(derivePolicyStats([{ status: "unknown", endDate: "2030-01-01" }], today)).toEqual({
      total: 1, active: 0, expiring: 0, lapsed: 0, other: 1,
    });
  });
});
