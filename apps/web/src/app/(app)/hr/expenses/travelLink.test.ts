import { describe, it, expect } from "vitest";
import { parseTravelRequestId } from "./travelLink";

describe("parseTravelRequestId (GAP-HR-TRAVEL-02)", () => {
  it("accepts a UUID", () => {
    expect(parseTravelRequestId("11111111-2222-4333-8444-555555555555")).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("rejects anything that is not a single UUID string", () => {
    expect(parseTravelRequestId(undefined)).toBeUndefined();
    expect(parseTravelRequestId("")).toBeUndefined();
    expect(parseTravelRequestId("not-a-uuid")).toBeUndefined();
    expect(parseTravelRequestId("11111111-2222-4333-8444-555555555555/../x")).toBeUndefined();
    expect(parseTravelRequestId("11111111-2222-4333-8444-555555555555&x=1")).toBeUndefined();
    expect(parseTravelRequestId(["11111111-2222-4333-8444-555555555555", "x"])).toBeUndefined();
  });
});
