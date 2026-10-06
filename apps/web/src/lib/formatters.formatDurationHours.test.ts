import { describe, it, expect } from "vitest";
import { formatDurationHours } from "./formatters";

/**
 * GAP-HELPDESK-REPORTS-02: formatDurationHours must agree across all helpdesk
 * pages (reports + home). 0/null/undefined → "—", <24h → "Xh", ≥24h → "Xd".
 */
describe("formatDurationHours (GAP-HELPDESK-REPORTS-02)", () => {
  it("returns em-dash for 0", () => {
    expect(formatDurationHours(0)).toBe("—");
  });

  it("returns em-dash for null / undefined / NaN / negative", () => {
    expect(formatDurationHours(null)).toBe("—");
    expect(formatDurationHours(undefined)).toBe("—");
    expect(formatDurationHours(NaN)).toBe("—");
    expect(formatDurationHours(-5)).toBe("—");
  });

  it("formats hours under 24 as Xh", () => {
    expect(formatDurationHours(5)).toBe("5.0h");
    expect(formatDurationHours(0.5)).toBe("0.5h");
    expect(formatDurationHours(23.9)).toBe("23.9h");
  });

  it("formats hours >= 24 as Xd", () => {
    expect(formatDurationHours(24)).toBe("1.0d");
    expect(formatDurationHours(31.2)).toBe("1.3d");
    expect(formatDurationHours(72)).toBe("3.0d");
  });
});
