import { describe, it, expect } from "vitest";
import {
  canTransition,
  calculateFeeMinor,
  generateApplicationNumber,
} from "../src/modules/applications/domain.js";

describe("advertisement-service domain smoke", () => {
  it("allows draft → submitted transition", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });

  it("rejects approved → submitted transition", () => {
    expect(canTransition("approved", "submitted")).toBe(false);
  });

  it("calculates hoarding fee with minimum floor", () => {
    const fee = calculateFeeMinor({
      advertisementType: "hoarding",
      dimensions: { widthFt: 10, heightFt: 5, areaInSqFt: 50 },
    });
    expect(fee).toBeGreaterThanOrEqual(500000n);
  });

  it("generates application number with tenant code", () => {
    const num = generateApplicationNumber("MUM", 42);
    expect(num).toMatch(/^ADV\/MUM\/\d{4}\/000042$/);
  });
});
