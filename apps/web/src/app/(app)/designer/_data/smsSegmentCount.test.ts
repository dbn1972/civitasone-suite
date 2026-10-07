import { describe, expect, it } from "vitest";
import { isGsm7, smsSegmentCount, smsStats } from "@/app/_components/ds/designer/notificationTypes";

/**
 * GAP-DESIGNER-DETAIL-B8-04: SMS segment counting must differentiate GSM-7
 * (160/153 chars) from UCS-2 (70/67 chars) so Hindi/Odia template costs are
 * shown correctly.
 */
describe("smsSegmentCount (GAP-DESIGNER-DETAIL-B8-04)", () => {
  it("detects GSM-7 for ASCII text", () => {
    expect(isGsm7("Hello world!")).toBe(true);
    expect(isGsm7("Your application {{app_no}} was received.")).toBe(true);
  });

  it("detects non-GSM-7 for Devanagari text", () => {
    expect(isGsm7("आपका आवेदन प्राप्त हुआ।")).toBe(false);
  });

  it("counts 160 ASCII chars as 1 GSM-7 segment", () => {
    expect(smsSegmentCount("a".repeat(160))).toBe(1);
  });

  it("counts 161 ASCII chars as 2 GSM-7 segments (153-char concat)", () => {
    expect(smsSegmentCount("a".repeat(161))).toBe(2);
  });

  it("counts 71 Devanagari chars as 2 UCS-2 segments", () => {
    // Each Devanagari char is outside GSM-7 charset
    const hindi = "आ".repeat(71);
    expect(smsSegmentCount(hindi)).toBe(2);
  });

  it("counts 70 Devanagari chars as 1 UCS-2 segment", () => {
    const hindi = "आ".repeat(70);
    expect(smsSegmentCount(hindi)).toBe(1);
  });

  it("smsStats warns for Unicode SMS exceeding 70 chars", () => {
    const hindi = "आ".repeat(71);
    const stats = smsStats(hindi);
    expect(stats.segments).toBe(2);
    expect(stats.warn).toMatch(/unicode/i);
  });

  it("smsStats returns no warning for ASCII SMS at 160 chars", () => {
    expect(smsStats("a".repeat(160)).warn).toBeNull();
  });
});
