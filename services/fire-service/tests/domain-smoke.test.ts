import { describe, it, expect } from "vitest";
import { canTransition, calculateFeeMinor } from "../src/modules/applications/domain.js";

describe("fire-service domain smoke", () => {
  it("allows draft → submitted transition", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });

  it("rejects draft → approved transition", () => {
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("calculates commercial occupancy fee in paise", () => {
    const fee = calculateFeeMinor("commercial", 1000);
    expect(fee).toBeGreaterThan(0n);
    expect(typeof fee).toBe("bigint");
  });
});
