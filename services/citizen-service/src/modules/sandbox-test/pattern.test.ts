import { describe, it, expect } from "vitest";
import { hiddenBlocksForPattern } from "./pattern.js";

describe("hiddenBlocksForPattern", () => {
  it("hides fee block for grievance", () => {
    expect(hiddenBlocksForPattern("grievance").has("b5")).toBe(true);
  });

  it("hides workflow for collection", () => {
    expect(hiddenBlocksForPattern("collection").has("b4")).toBe(true);
  });
});
