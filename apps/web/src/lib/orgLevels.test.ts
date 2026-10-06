import { describe, it, expect } from "vitest";
import { normalizeHexColor, tint, validateOrgLevels, ORG_LEVEL_FALLBACK_COLOR } from "./orgLevels";

describe("orgConfig helpers (GAP-PLATFORM-ADMIN-ORG-CONFIG-04/06)", () => {
  describe("normalizeHexColor", () => {
    it("passes a valid 6-digit hex through (lowercased)", () => {
      expect(normalizeHexColor("#1E40AF")).toBe("#1e40af");
    });
    it("expands a 3-digit hex", () => {
      expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    });
    it("falls back for rgb()/named/empty/invalid", () => {
      expect(normalizeHexColor("rgb(1,2,3)")).toBe(ORG_LEVEL_FALLBACK_COLOR);
      expect(normalizeHexColor("rebeccapurple")).toBe(ORG_LEVEL_FALLBACK_COLOR);
      expect(normalizeHexColor("")).toBe(ORG_LEVEL_FALLBACK_COLOR);
      expect(normalizeHexColor(null)).toBe(ORG_LEVEL_FALLBACK_COLOR);
    });
  });

  describe("tint", () => {
    it("produces a valid rgba() from a 3-digit hex (previously invalid '#abc18')", () => {
      expect(tint("#abc", 0.1)).toBe("rgba(170, 187, 204, 0.1)");
    });
    it("produces rgba() from a 6-digit hex", () => {
      expect(tint("#1e40af", 0.25)).toBe("rgba(30, 64, 175, 0.25)");
    });
    it("uses the fallback colour for an invalid input rather than breaking", () => {
      expect(tint("not-a-color", 0.1)).toBe("rgba(51, 65, 85, 0.1)");
    });
  });

  describe("validateOrgLevels", () => {
    it("rejects duplicate labels case-insensitively", () => {
      const r = validateOrgLevels([
        { id: "a", label: "Division" },
        { id: "b", label: "division" },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/duplicate/i);
    });
    it("rejects an empty label", () => {
      const r = validateOrgLevels([{ id: "a", label: "  " }]);
      expect(r.ok).toBe(false);
    });
    it("rejects an over-long description", () => {
      const r = validateOrgLevels([{ id: "a", label: "Ministry", description: "x".repeat(201) }]);
      expect(r.ok).toBe(false);
    });
    it("accepts a valid, unique set", () => {
      const r = validateOrgLevels([
        { id: "a", label: "Ministry", description: "ok", examples: "e" },
        { id: "b", label: "Department" },
      ]);
      expect(r.ok).toBe(true);
    });
  });
});
