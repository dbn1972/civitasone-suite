import { describe, it, expect } from "vitest";
import { classifyGemStatus, countsAsSpend, bucketCounts } from "./gemStatus";

describe("gemStatus — GAP-PROCUREMENT-GEM-04 / GEM-02", () => {
  it("normalises case/spacing/underscores into one bucket", () => {
    expect(classifyGemStatus("In Transit")).toBe("inTransit");
    expect(classifyGemStatus("in_transit")).toBe("inTransit");
    expect(classifyGemStatus("IN TRANSIT")).toBe("inTransit");
    expect(classifyGemStatus("Shipped")).toBe("inTransit");
    expect(classifyGemStatus("Delivered")).toBe("delivered");
    expect(classifyGemStatus("Cancelled")).toBe("cancelled");
    expect(classifyGemStatus("Returned")).toBe("cancelled");
    expect(classifyGemStatus("Placed")).toBe("other");
    expect(classifyGemStatus(null)).toBe("other");
  });

  it("excludes cancelled/returned from spend, counts everything else", () => {
    expect(countsAsSpend("Cancelled")).toBe(false);
    expect(countsAsSpend("Returned")).toBe(false);
    expect(countsAsSpend("Delivered")).toBe(true);
    expect(countsAsSpend("Placed")).toBe(true); // unknown but not provably cancelled
  });

  it("buckets reconcile to the total (every order in exactly one bucket)", () => {
    const c = bucketCounts(["Delivered", "Shipped", "Cancelled", "Placed"]);
    expect(c.delivered).toBe(1);
    expect(c.inTransit).toBe(1);
    expect(c.cancelled).toBe(1);
    expect(c.other).toBe(1);
    expect(c.delivered + c.inTransit + c.cancelled + c.other).toBe(c.total);
    expect(c.total).toBe(4);
  });

  it("does not throw on an unknown status", () => {
    expect(() => classifyGemStatus("something weird")).not.toThrow();
    expect(classifyGemStatus("something weird")).toBe("other");
  });
});
