import { describe, it, expect } from "vitest";
import { parseListPayload } from "./jobsPayload";

describe("parseListPayload", () => {
  it("accepts a bare array, data and items", () => {
    expect(parseListPayload([1])).toEqual([1]);
    expect(parseListPayload({ data: [2] })).toEqual([2]);
    expect(parseListPayload({ items: [3] })).toEqual([3]);
  });
  it("returns null for anything else", () => {
    expect(parseListPayload({})).toBeNull();
    expect(parseListPayload(null)).toBeNull();
    expect(parseListPayload("x")).toBeNull();
  });
});
