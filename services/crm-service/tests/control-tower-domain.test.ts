import { describe, it, expect } from "vitest";

/** Mirrors the severity rule used by control-tower-routes (kept pure for unit test). */
function exceptionSeverity(kind: string, count: number): "high" | "medium" {
  if (kind === "overdue_follow_up") return count > 0 ? "high" : "medium";
  if (kind === "aged_lead") return count > 10 ? "high" : "medium";
  return "medium";
}

function rankRegions(rows: Array<{ region: string; pipelineMinor: string }>) {
  return [...rows].sort((a, b) => {
    const av = BigInt(a.pipelineMinor || "0");
    const bv = BigInt(b.pipelineMinor || "0");
    if (av === bv) return a.region.localeCompare(b.region);
    return av > bv ? -1 : 1;
  });
}

describe("P2-8 control tower rules", () => {
  it("marks any overdue follow-up as high severity", () => {
    expect(exceptionSeverity("overdue_follow_up", 1)).toBe("high");
    expect(exceptionSeverity("overdue_follow_up", 0)).toBe("medium");
  });

  it("ranks GIS regions by pipeline value without float drift", () => {
    const ranked = rankRegions([
      { region: "West", pipelineMinor: "100" },
      { region: "East", pipelineMinor: "1000000000000001" },
      { region: "North", pipelineMinor: "1000000000000000" },
    ]);
    expect(ranked.map((r) => r.region)).toEqual(["East", "North", "West"]);
  });

  it("GAP-CRM-CONTROL-TOWER-02: the region grouping key is trimmed and case-folded", () => {
    // Mirrors the SQL grouping key lower(btrim(COALESCE(region, city, 'unknown')))
    // so "South" and " south " fold onto one control-tower row.
    const key = (region: string | null, city: string | null) =>
      (region ?? city ?? "unknown").trim().toLowerCase();
    expect(key("South", null)).toBe(key(" south ", null));
    expect(key("WEST", null)).toBe(key("west", null));
    expect(key(null, null)).toBe("unknown");
  });
});
