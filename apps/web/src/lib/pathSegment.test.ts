import { describe, it, expect } from "vitest";
import { isUuid, pathSeg } from "./pathSegment";

describe("pathSegment", () => {
  it("accepts a uuid and rejects traversal / junk", () => {
    expect(isUuid("11111111-aaaa-4000-8000-000000000001")).toBe(true);
    expect(isUuid("../users")).toBe(false);
    expect(isUuid("..%2Fusers")).toBe(false);
    expect(isUuid("t-1")).toBe(false);
  });
  it("encodes a segment so it cannot escape its path position", () => {
    expect(pathSeg("../users")).toBe("..%2Fusers");
    expect(pathSeg("a/b?c")).toBe("a%2Fb%3Fc");
  });
});
