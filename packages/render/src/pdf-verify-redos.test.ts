import { describe, it, expect } from "vitest";
import { trimTrailingZeros } from "./pdf-verify.js";

describe("trimTrailingZeros (CodeQL alert 939)", () => {
  it("strips only the trailing run of zeros", () => {
    expect(trimTrailingZeros("30820100")).toBe("308201");
    expect(trimTrailingZeros("0000")).toBe("");
    expect(trimTrailingZeros("")).toBe("");
    expect(trimTrailingZeros("a0b")).toBe("a0b");
  });

  it("is linear on a long run of zeros that is not at the end", () => {
    const evil = "0".repeat(300_000) + "1";
    const t0 = Date.now();
    expect(trimTrailingZeros(evil)).toBe(evil);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
