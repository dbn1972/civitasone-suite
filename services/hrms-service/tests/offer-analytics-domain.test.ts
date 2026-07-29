import { describe, it, expect } from "vitest";
import {
  offerFunnel, acceptanceRatePct, pendingAgeing, declineBreakdown, type OfferStat,
} from "../src/modules/recruitment/offer-analytics-domain.js";

const O = (over: Partial<OfferStat> = {}): OfferStat => ({ status: "draft", ...over });
const DAY = 86_400_000;

describe("offerFunnel", () => {
  it("counts reached-candidate, decided and pending offers", () => {
    const f = offerFunnel([
      O({ status: "draft" }),
      O({ status: "released" }),
      O({ status: "accepted" }),
      O({ status: "declined" }),
      O({ status: "expired" }),
      O({ status: "withdrawn" }),
    ]);
    expect(f).toEqual({ total: 6, released: 5, accepted: 1, declined: 1, expired: 1, withdrawn: 1, pending: 1 });
  });
});

describe("acceptanceRatePct", () => {
  it("is accepted / (accepted+declined+expired), ignoring withdrawals and undecided", () => {
    const r = acceptanceRatePct([
      O({ status: "accepted" }), O({ status: "accepted" }), O({ status: "accepted" }),
      O({ status: "declined" }), O({ status: "expired" }),
      O({ status: "withdrawn" }), O({ status: "released" }),
    ]);
    expect(r).toBe(60); // 3 / (3+1+1) = 60%
  });
  it("returns null when nothing is decided", () => {
    expect(acceptanceRatePct([O({ status: "released" }), O({ status: "draft" })])).toBeNull();
  });
});

describe("pendingAgeing", () => {
  it("buckets pending (released, undecided) offers by days since release", () => {
    const now = 100 * DAY;
    const b = pendingAgeing([
      O({ status: "released", releasedAtMs: now - 1 * DAY }),   // 0-3
      O({ status: "released", releasedAtMs: now - 6 * DAY }),   // 4-7
      O({ status: "released", releasedAtMs: now - 10 * DAY }),  // 8-14
      O({ status: "released", releasedAtMs: now - 30 * DAY }),  // 15+
      O({ status: "accepted", releasedAtMs: now - 30 * DAY }),  // not pending -> excluded
    ], now);
    expect(b.map((x) => x.count)).toEqual([1, 1, 1, 1]);
  });
});

describe("declineBreakdown", () => {
  it("groups declined offers by reason code, defaulting to unspecified", () => {
    const d = declineBreakdown([
      O({ status: "declined", declineReasonCode: "salary" }),
      O({ status: "declined", declineReasonCode: "salary" }),
      O({ status: "declined", declineReasonCode: "relocation" }),
      O({ status: "declined", declineReasonCode: null }),
      O({ status: "accepted", declineReasonCode: "salary" }), // not declined -> excluded
    ]);
    expect(d).toEqual({ salary: 2, relocation: 1, unspecified: 1 });
  });
});
