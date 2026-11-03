import { describe, it, expect } from "vitest";
import { toPct, formatWeightPct } from "./taskPct";

describe("task percentage coercion (UAT Phase 1B: /projects/[id]/tasks render crash)", () => {
  it("accepts the NUMERIC decimal strings project-service actually returns", () => {
    expect(toPct("30.00")).toBe(30);
    expect(toPct("55.5")).toBe(55.5);
    expect(formatWeightPct("60.00")).toBe("60.0%");
  });
  it("still accepts plain numbers", () => {
    expect(toPct(12.25)).toBe(12.25);
    expect(formatWeightPct(12.25)).toBe("12.3%");
  });
  it("never fabricates 0 for a missing/garbage value", () => {
    expect(toPct(null)).toBeNull();
    expect(toPct(undefined)).toBeNull();
    expect(toPct("")).toBeNull();
    expect(toPct("abc")).toBeNull();
    expect(formatWeightPct(null)).toBe("—");
  });
});
