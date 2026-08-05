import { describe, it, expect } from "vitest";
import { hotExceptions, rankRegions, totalExceptionCount } from "./tower";

describe("P2-8 control tower FE helpers", () => {
  it("ranks regions by pipeline bigint", () => {
    expect(
      rankRegions([
        { region: "A", dealCount: 1, pipelineMinor: "10" },
        { region: "B", dealCount: 1, pipelineMinor: "100" },
      ]).map((r) => r.region),
    ).toEqual(["B", "A"]);
  });

  it("surfaces high-severity exceptions first", () => {
    const ranked = hotExceptions([
      { id: "1", kind: "dormant_account", label: "d", severity: "medium", href: "/", count: 9 },
      { id: "2", kind: "overdue_follow_up", label: "o", severity: "high", href: "/", count: 1 },
    ]);
    expect(ranked[0]?.id).toBe("2");
    expect(totalExceptionCount(ranked)).toBe(10);
  });
});
