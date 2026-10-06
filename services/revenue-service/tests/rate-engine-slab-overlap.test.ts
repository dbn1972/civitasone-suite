/**
 * GAP-REVENUE-CONFIG-01 — assertNoSlabOverlap rejects a new rate slab that
 * overlaps an existing active slab (same head+type, intersecting effective
 * window and, for bands, intersecting range). Overlapping slabs make rate
 * lookup non-deterministic → wrong tax on every demand in the overlap.
 */
import { describe, it, expect } from "vitest";
import { assertNoSlabOverlap, DomainError, type SlabWindow } from "../src/modules/rate-engine/domain.js";

const flat = (from: string, to: string | null, active = true): SlabWindow => ({
  slabType: "flat",
  bandFrom: null,
  bandTo: null,
  effectiveFrom: from,
  effectiveTo: to,
  isActive: active,
});

const band = (bf: bigint, bt: bigint | null, from: string, to: string | null): SlabWindow => ({
  slabType: "band",
  bandFrom: bf,
  bandTo: bt,
  effectiveFrom: from,
  effectiveTo: to,
  isActive: true,
});

describe("assertNoSlabOverlap (GAP-REVENUE-CONFIG-01)", () => {
  it("allows a non-overlapping effective window for a flat slab", () => {
    const existing = [flat("2024-04-01", "2025-03-31")];
    expect(() => assertNoSlabOverlap(existing, flat("2025-04-01", null))).not.toThrow();
  });

  it("rejects a flat slab whose effective window overlaps an existing active one", () => {
    const existing = [flat("2024-04-01", null)];
    expect(() => assertNoSlabOverlap(existing, flat("2024-06-01", null))).toThrow(DomainError);
    expect(() => assertNoSlabOverlap(existing, flat("2024-06-01", null))).toThrow(/overlap/i);
  });

  it("ignores inactive existing slabs", () => {
    const existing = [flat("2024-04-01", null, false)];
    expect(() => assertNoSlabOverlap(existing, flat("2024-06-01", null))).not.toThrow();
  });

  it("rejects overlapping bands in the same period", () => {
    // existing band [0, 10000) ; candidate [5000, 20000) overlaps.
    const existing = [band(0n, 10000n, "2024-04-01", null)];
    expect(() => assertNoSlabOverlap(existing, band(5000n, 20000n, "2024-04-01", null))).toThrow(/overlap/i);
  });

  it("allows adjacent (non-overlapping) bands in the same period", () => {
    // [0, 10000) and [10000, 20000) are adjacent, not overlapping.
    const existing = [band(0n, 10000n, "2024-04-01", null)];
    expect(() => assertNoSlabOverlap(existing, band(10000n, 20000n, "2024-04-01", null))).not.toThrow();
  });
});
