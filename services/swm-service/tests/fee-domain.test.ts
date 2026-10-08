/**
 * TX-008 — server-derived fee calculation, unit-level.
 *
 * Complements the integration-level assertions in collection.test.ts and
 * bulk-generators.test.ts (which prove the HTTP+consumer path ignores a
 * client-submitted feeMinor) by pinning the actual rate tables so a future
 * edit can't silently change pricing without a test failing.
 */
import { describe, it, expect } from "vitest";
import { calculateFeeMinor as calculateCollectionFeeMinor } from "../src/modules/collection/domain.js";
import { calculateFeeMinor as calculateGeneratorFeeMinor } from "../src/modules/bulk_generators/domain.js";

describe("collection domain — calculateFeeMinor", () => {
  it("is a pure function of wasteType only (no client input)", () => {
    // GAP2-PLATFORM-MONEY-INT-02: fees are bigint paise end to end (the
    // swm_collection_requests.fee_minor column is now bigint, not int4).
    expect(calculateCollectionFeeMinor("hazardous")).toBe(1000000n);
    expect(calculateCollectionFeeMinor("bulky_item")).toBe(50000n);
    expect(calculateCollectionFeeMinor("garden_waste")).toBe(20000n);
  });
});

describe("bulk_generators domain — calculateFeeMinor", () => {
  it("is a pure function of generatorType + category only (no client input)", () => {
    // GAP2-PLATFORM-MONEY-INT-02: bigint paise (swm_bulk_generators.fee_minor
    // is now bigint).
    expect(calculateGeneratorFeeMinor("hospital", "mixed")).toBe(2500000n);
    expect(calculateGeneratorFeeMinor("market", "wet")).toBe(600000n);
    expect(calculateGeneratorFeeMinor("hotel", "dry")).toBe(800000n);
  });
});
