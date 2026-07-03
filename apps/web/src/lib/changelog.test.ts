import { describe, it, expect } from "vitest";
import {
  CURRENT_VERSION,
  CHANGELOG,
  compareVersions,
  hasUnseenUpdate,
  getLatestEntry,
} from "./changelog";

describe("changelog", () => {
  describe("CHANGELOG structure", () => {
    it("has at least one entry", () => {
      expect(CHANGELOG.length).toBeGreaterThan(0);
    });

    it("every entry has required fields", () => {
      for (const entry of CHANGELOG) {
        expect(entry.version).toBeTruthy();
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.title).toBeTruthy();
        expect(entry.highlights.length).toBeGreaterThan(0);
      }
    });

    it("entries are ordered newest-first", () => {
      for (let i = 0; i < CHANGELOG.length - 1; i++) {
        expect(compareVersions(CHANGELOG[i].version, CHANGELOG[i + 1].version)).toBe(1);
      }
    });

    it("CURRENT_VERSION matches the first changelog entry", () => {
      expect(CURRENT_VERSION).toBe(CHANGELOG[0].version);
    });
  });

  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    });

    it("returns 1 when first is greater", () => {
      expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
      expect(compareVersions("0.2.0", "0.1.0")).toBe(1);
      expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    });

    it("returns -1 when first is smaller", () => {
      expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
      expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
    });

    it("handles different-length versions", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0", "1.0.1")).toBe(-1);
    });
  });

  describe("hasUnseenUpdate", () => {
    it("returns true when lastSeenVersion is null", () => {
      expect(hasUnseenUpdate(null)).toBe(true);
    });

    it("returns true when lastSeenVersion is older", () => {
      expect(hasUnseenUpdate("0.1.0")).toBe(true);
    });

    it("returns false when lastSeenVersion is current", () => {
      expect(hasUnseenUpdate(CURRENT_VERSION)).toBe(false);
    });

    it("returns false when lastSeenVersion is newer (edge case)", () => {
      expect(hasUnseenUpdate("99.0.0")).toBe(false);
    });
  });

  describe("getLatestEntry", () => {
    it("returns the first changelog entry", () => {
      const entry = getLatestEntry();
      expect(entry).toBeDefined();
      expect(entry!.version).toBe(CURRENT_VERSION);
    });
  });
});
