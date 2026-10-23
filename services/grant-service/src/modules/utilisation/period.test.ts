import { describe, it, expect } from "vitest";
import { periodEnd } from "./period.js";

describe("periodEnd (real month end, not a fabricated 28th)", () => {
  it.each([
    ["2026-01", "2026-01-31"],
    ["2026-02", "2026-02-28"],
    ["2028-02", "2028-02-29"], // leap year
    ["2100-02", "2100-02-28"], // century, not a leap year
    ["2026-04", "2026-04-30"],
    ["2026-12", "2026-12-31"],
  ])("%s -> %s", (period, end) => {
    expect(periodEnd(period)).toBe(end);
  });

  it("falls back to the 28th for an unparseable period", () => {
    expect(periodEnd("garbage")).toBe("garbage-28");
    expect(periodEnd("2026-13")).toBe("2026-13-28");
  });
});
