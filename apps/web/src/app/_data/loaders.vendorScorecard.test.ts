import { describe, it, expect } from "vitest";
import { mapVendorScorecard } from "./loaders";

// GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-04/05: the API stamps computedAt, and
// returns a placeholder overallRating of 0 for an unrated vendor.
describe("mapVendorScorecard", () => {
  const full = {
    vendorId: "v1", overallRating: 86, ratingBand: "B", totalOrders: 10,
    onTimeDeliveries: 8, lateDeliveries: 2, qualityRejections: 1, slaBreaches: 0,
    deliveryScore: 80, qualityScore: 90, slaScore: 70,
    computedAt: "2026-09-12T06:30:00.000Z",
  };

  it("maps computedAt to lastUpdated so the 'As of' stamp is not a dash", () => {
    expect(mapVendorScorecard({ data: full })?.lastUpdated).toBe("2026-09-12T06:30:00.000Z");
  });

  it("prefers an explicit lastUpdated when the API sends one", () => {
    expect(mapVendorScorecard({ data: { ...full, lastUpdated: "2026-10-01T00:00:00.000Z" } })?.lastUpdated).toBe("2026-10-01T00:00:00.000Z");
  });

  it("maps an unrated vendor's placeholder 0 to null (not a score of 0)", () => {
    const sc = mapVendorScorecard({ data: { vendorId: "v2", ratingBand: "unrated", overallRating: 0, totalOrders: 0 } });
    expect(sc?.overallRating).toBeNull();
    expect(sc?.deliveryScore).toBeNull();
    expect(sc?.lastUpdated).toBeNull();
    expect(sc?.ratingBand).toBe("unrated");
  });

  it("keeps real scores for a rated vendor and nulls only the fields that are absent", () => {
    const sc = mapVendorScorecard({ data: { ...full, slaScore: undefined } });
    expect(sc?.overallRating).toBe(86);
    expect(sc?.slaScore).toBeNull();
    expect(sc?.qualityScore).toBe(90);
  });

  it("returns null for a payload with no data envelope", () => {
    expect(mapVendorScorecard(null)).toBeNull();
    expect(mapVendorScorecard({})).toBeNull();
  });
});
