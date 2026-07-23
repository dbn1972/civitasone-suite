import { describe, it, expect } from "vitest";
import { newId, newIds } from "./ids.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("shared/ids", () => {
  describe("newId", () => {
    it("returns a valid UUID v4", () => {
      const id = newId();
      expect(id).toMatch(UUID_RE);
    });

    it("generates unique IDs on successive calls", () => {
      const ids = new Set(Array.from({ length: 100 }, () => newId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("newIds", () => {
    it("returns the requested number of UUIDs", () => {
      const ids = newIds(5);
      expect(ids).toHaveLength(5);
      ids.forEach((id) => expect(id).toMatch(UUID_RE));
    });

    it("returns an empty array for count 0", () => {
      expect(newIds(0)).toEqual([]);
    });

    it("generates unique IDs within a batch", () => {
      const ids = newIds(50);
      const unique = new Set(ids);
      expect(unique.size).toBe(50);
    });
  });
});
