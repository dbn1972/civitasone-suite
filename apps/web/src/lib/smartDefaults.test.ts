import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveRecentValue, suggestFromRecent } from "./smartDefaults";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("smartDefaults", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("saveRecentValue", () => {
    it("stores a value in localStorage", () => {
      saveRecentValue("vendor", "Acme Corp");
      const stored = JSON.parse(localStorageMock.getItem("civitasone.recent.vendor")!);
      expect(stored).toContain("Acme Corp");
    });

    it("deduplicates values and puts the latest first", () => {
      saveRecentValue("vendor", "Alpha");
      saveRecentValue("vendor", "Beta");
      saveRecentValue("vendor", "Alpha"); // re-add Alpha
      const stored = JSON.parse(localStorageMock.getItem("civitasone.recent.vendor")!);
      expect(stored[0]).toBe("Alpha");
      expect(stored[1]).toBe("Beta");
      expect(stored.filter((v: string) => v === "Alpha")).toHaveLength(1);
    });

    it("caps at max entries (default 10)", () => {
      for (let i = 0; i < 15; i++) {
        saveRecentValue("hoa", `code-${i}`);
      }
      const stored = JSON.parse(localStorageMock.getItem("civitasone.recent.hoa")!);
      expect(stored).toHaveLength(10);
      expect(stored[0]).toBe("code-14"); // most recent first
    });

    it("respects custom max parameter", () => {
      for (let i = 0; i < 8; i++) {
        saveRecentValue("cost-center", `CC-${i}`, 5);
      }
      const stored = JSON.parse(localStorageMock.getItem("civitasone.recent.cost-center")!);
      expect(stored).toHaveLength(5);
    });
  });

  describe("suggestFromRecent", () => {
    beforeEach(() => {
      saveRecentValue("vendor", "Acme Corporation");
      saveRecentValue("vendor", "Beta Industries");
      saveRecentValue("vendor", "Gamma Supplies");
      saveRecentValue("vendor", "Acme Traders");
    });

    it("returns all recent values when query is empty", () => {
      const results = suggestFromRecent("vendor", "");
      expect(results).toHaveLength(4);
    });

    it("filters by fuzzy match (case-insensitive)", () => {
      const results = suggestFromRecent("vendor", "acme");
      expect(results).toHaveLength(2);
      expect(results).toContain("Acme Corporation");
      expect(results).toContain("Acme Traders");
    });

    it("returns empty array when no match", () => {
      const results = suggestFromRecent("vendor", "zzz-nonexistent");
      expect(results).toHaveLength(0);
    });

    it("returns empty array for unknown key", () => {
      const results = suggestFromRecent("unknown-key", "");
      expect(results).toHaveLength(0);
    });
  });
});
