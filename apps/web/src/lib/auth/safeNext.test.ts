import { describe, it, expect } from "vitest";
import { safeNextPath } from "./safeNext";

describe("safeNextPath", () => {
  it("accepts same-origin paths with query and hash", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/a/b?x=1#h")).toBe("/a/b?x=1#h");
  });
  it.each([
    ["backslash host", "/\\evil.com"],
    ["double slash", "//evil.com"],
    ["slash-backslash mix", "/\\/evil.com"],
    ["tab inside", "/\t/evil.com"],
    ["newline", "/\nfoo"],
    ["absolute url", "https://evil.com"],
    ["relative", "dashboard"],
    ["empty", ""],
  ])("rejects %s", (_n, v) => {
    expect(safeNextPath(v)).toBeNull();
  });
  it("rejects null and undefined", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
