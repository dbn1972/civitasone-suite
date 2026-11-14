import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

describe("leaveApply.zeroDayReason", () => {
  it("exists in English and Hindi, and the Hindi is a real translation", () => {
    const e = (en as { leaveApply: Record<string, string> }).leaveApply.zeroDayReason;
    const h = (hi as { leaveApply: Record<string, string> }).leaveApply.zeroDayReason;
    expect(e).toBe("The selected dates are holidays or weekends; no leave days to apply");
    expect(h).toMatch(/[ऀ-ॿ]/);
    expect(h).not.toBe(e);
  });
});
