import { describe, it, expect } from "vitest";
import { hierarchyState } from "./hierarchyState";

describe("hierarchyState", () => {
  it("reports error (never empty) when the load failed", () => {
    expect(hierarchyState({ source: "error", data: [] })).toBe("error");
  });
  it("reports empty only for a clean empty load", () => {
    expect(hierarchyState({ source: "api", data: [] })).toBe("empty");
  });
  it("reports data when rows exist", () => {
    expect(hierarchyState({ source: "api", data: [1] })).toBe("data");
  });
});
