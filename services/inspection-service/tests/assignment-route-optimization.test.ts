/**
 * Unit tests for field route optimization (SVC-109).
 *
 * Proves the nearest-neighbour sequencing orders sites by geo-proximity
 * deterministically and yields a shorter route than the arbitrary input order.
 *
 * Validates: SVC-109 (geo-proximity route optimization)
 */
import { describe, it, expect } from "vitest";
import {
  sequenceByNearestNeighbour,
  routeDistanceMeters,
  planTourRoute,
  type TourSite,
  type GeoPoint,
} from "../src/modules/assignment/domain.js";

// A deliberately scrambled set of sites along a rough north→south corridor near Delhi.
// Input order is far from optimal so a proximity sweep must reorder it.
const START: GeoPoint = { latitude: 28.70, longitude: 77.10 };
const SITES: TourSite[] = [
  { entityId: "e-far", inspectionId: "i-far", latitude: 28.40, longitude: 77.10 }, // farthest south
  { entityId: "e-near", inspectionId: "i-near", latitude: 28.68, longitude: 77.10 }, // closest to start
  { entityId: "e-mid2", inspectionId: "i-mid2", latitude: 28.50, longitude: 77.10 },
  { entityId: "e-mid1", inspectionId: "i-mid1", latitude: 28.60, longitude: 77.10 },
];

describe("sequenceByNearestNeighbour", () => {
  it("orders sites by nearest-neighbour proximity from the start point", () => {
    const seq = sequenceByNearestNeighbour(START, SITES);
    expect(seq.map((s) => s.entityId)).toEqual(["e-near", "e-mid1", "e-mid2", "e-far"]);
  });

  it("annotates each stop with a monotonically increasing seq index", () => {
    const seq = sequenceByNearestNeighbour(START, SITES);
    expect(seq.map((s) => s.seq)).toEqual([0, 1, 2, 3]);
  });

  it("records a non-negative leg distance for every stop", () => {
    const seq = sequenceByNearestNeighbour(START, SITES);
    for (const s of seq) expect(s.legMeters).toBeGreaterThanOrEqual(0);
  });

  it("produces a route no longer than the arbitrary input order", () => {
    const optimized = sequenceByNearestNeighbour(START, SITES);
    const optimizedDist = routeDistanceMeters(START, optimized);
    const naiveDist = routeDistanceMeters(START, SITES);
    expect(optimizedDist).toBeLessThan(naiveDist);
  });

  it("is deterministic — identical inputs give identical order", () => {
    const a = sequenceByNearestNeighbour(START, SITES).map((s) => s.entityId);
    const b = sequenceByNearestNeighbour(START, SITES).map((s) => s.entityId);
    expect(a).toEqual(b);
  });

  it("does not mutate the input array", () => {
    const copy = SITES.slice();
    sequenceByNearestNeighbour(START, SITES);
    expect(SITES).toEqual(copy);
  });

  it("returns an empty sequence for no sites", () => {
    expect(sequenceByNearestNeighbour(START, [])).toEqual([]);
  });
});

describe("planTourRoute", () => {
  const DATES = ["2026-08-01", "2026-08-02", "2026-08-03"];

  it("packs sequenced sites across dates up to the daily maximum", () => {
    const days = planTourRoute(START, SITES, DATES, 2);
    expect(days).toHaveLength(2); // 4 sites / 2 per day
    expect(days[0]!.date).toBe("2026-08-01");
    expect(days[0]!.sites).toHaveLength(2);
    expect(days[1]!.sites).toHaveLength(2);
  });

  it("preserves the global proximity order across day boundaries", () => {
    const days = planTourRoute(START, SITES, DATES, 2);
    const flattened = days.flatMap((d) => d.sites.map((s) => s.entityId));
    expect(flattened).toEqual(["e-near", "e-mid1", "e-mid2", "e-far"]);
  });

  it("re-indexes seq within each day starting at 0", () => {
    const days = planTourRoute(START, SITES, DATES, 2);
    expect(days[0]!.sites.map((s) => s.seq)).toEqual([0, 1]);
    expect(days[1]!.sites.map((s) => s.seq)).toEqual([0, 1]);
  });

  it("omits trailing empty days when sites run out", () => {
    const days = planTourRoute(START, SITES, DATES, 4);
    expect(days).toHaveLength(1);
    expect(days[0]!.sites).toHaveLength(4);
  });

  it("returns no days when there are no sites", () => {
    expect(planTourRoute(START, [], DATES, 2)).toEqual([]);
  });
});
