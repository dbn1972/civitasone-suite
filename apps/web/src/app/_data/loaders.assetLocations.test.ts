import { describe, it, expect } from "vitest";
import { mapAssetLocations } from "./loaders";

describe("mapAssetLocations (GAP-ASSETS-LOCATIONS-03)", () => {
  it("keeps active locations with their parent, drops deactivated and malformed rows", () => {
    const rows = mapAssetLocations({ data: [
      { id: "1", code: "A", name: "Block A", parentId: null, isActive: true },
      { id: "2", code: "A-1", name: "Floor 1", parentId: "1" },
      { id: "3", code: "OLD", name: "Old", isActive: false },
      { id: "4", code: "NONAME" },
      "junk",
    ] });
    expect(rows).toEqual([
      { id: "1", code: "A", name: "Block A", parentId: null },
      { id: "2", code: "A-1", name: "Floor 1", parentId: "1" },
    ]);
  });
  it("returns null for a non-list payload so the loader reports an error", () => {
    expect(mapAssetLocations({ nope: 1 })).toBeNull();
  });
});
