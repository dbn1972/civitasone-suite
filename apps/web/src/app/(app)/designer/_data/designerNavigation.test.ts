import { describe, it, expect } from "vitest";
import { adjacentBlocks, visibleBlockIds } from "./designerNavigation";

describe("designerNavigation", () => {
  it("skips b6 for collection pattern", () => {
    expect(visibleBlockIds("collection")).not.toContain("b6");
    expect(adjacentBlocks("collection", "b5").next).toBe("b7");
  });

  it("routes b8 next to test", () => {
    expect(adjacentBlocks("certificate", "b8").next).toBe("test");
  });

  it("routes b6 prev from b7 for collection", () => {
    expect(adjacentBlocks("collection", "b7").prev).toBe("b5");
  });
});
