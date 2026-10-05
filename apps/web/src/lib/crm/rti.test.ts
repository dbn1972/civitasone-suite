import { describe, it, expect } from "vitest";
import { RTI_SECTIONS, sectionLabel } from "./rti";

describe("RTI sectionLabel (GAP-CRM-RTI-06)", () => {
  it("returns the full statutory label by default", () => {
    expect(sectionLabel("s.6")).toBe("§6 — Information Request");
    expect(sectionLabel("s.11")).toBe("§11 — Third-party Information");
  });

  it("returns the compact label when short is requested", () => {
    expect(sectionLabel("s.6", true)).toBe("§6 Information");
    expect(sectionLabel("s.11", true)).toBe("§11 Third-party");
  });

  it("returns the raw value for an unknown section", () => {
    expect(sectionLabel("s.99")).toBe("s.99");
    expect(sectionLabel("s.99", true)).toBe("s.99");
  });

  it("exposes a canonical list the forms iterate over", () => {
    expect(RTI_SECTIONS.map((s) => s.value)).toEqual(["s.6", "s.11"]);
    // Every entry has both a full and a short label.
    for (const s of RTI_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.short.length).toBeGreaterThan(0);
    }
  });
});
