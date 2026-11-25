import { describe, it, expect } from "vitest";
import { buildKpis, canSeeModule, formatKpiValue, KPI_DEFS, type FactAgg } from "../src/modules/kpi/producer.js";

const agg = (source: string, eventType: string, status: string, c: number, s: number, pc = 0, ps = 0): FactAgg => ({
  source, eventType, status, curCount: c, curSum: s, prevCount: pc, prevSum: ps,
});

const AGGS: FactAgg[] = [
  agg("finance", "payment.made", "recorded", 4, 1_000_000, 2, 500_000),
  agg("visitor", "checked_in", "checked_in", 40, 0, 40, 0),
  agg("visitor", "overstay.alerted", "overstay", 2, 0, 4, 0),
  agg("court", "case.registered", "recorded", 10, 0),
  agg("court", "case.status_changed", "disposed", 4, 0),
];
const ADMIN = ["analytics_admin"];

describe("buildKpis (D9 contract)", () => {
  it("returns value/unit/target/direction/owner per KPI from real aggregates", () => {
    const k = Object.fromEntries(buildKpis(AGGS, ADMIN).map((x) => [x.key, x]));
    expect(k["finance.payments_made_paise"]).toMatchObject({ value: 1_000_000, unit: "paise", direction: "up_good", owner: "Finance Office", target: null, status: "no_target", trendPct: 100 });
    expect(k["finance.payments_made_paise"].currentValue).toBe("₹10,000");
    expect(k["finance.payments_made_count"]).toMatchObject({ value: 4, unit: "count" });
    expect(k["visitor.overstay_rate_pct"]).toMatchObject({ value: 5, unit: "percent", direction: "down_good", trendPct: -50 });
    expect(k["court.disposals_per_registration_pct"]).toMatchObject({ value: 40, unit: "percent" });
  });

  it("omits KPIs with no signal instead of faking 0/dash", () => {
    const keys = buildKpis(AGGS, ADMIN).map((x) => x.key);
    expect(keys).not.toContain("grants.disbursed_paise");
    expect(keys).not.toContain("meeting.completed_count");
    expect(buildKpis([], ADMIN)).toEqual([]);
  });

  it("omits a ratio whose denominator is zero", () => {
    const only = [agg("visitor", "overstay.alerted", "overstay", 3, 0)];
    expect(buildKpis(only, ADMIN).map((x) => x.key)).not.toContain("visitor.overstay_rate_pct");
  });

  it("a real zero (source active, none this window) is kept as 0", () => {
    const k = buildKpis([agg("finance", "payment.made", "recorded", 0, 0, 3, 300)], ADMIN).find((x) => x.key === "finance.payments_made_count");
    expect(k).toMatchObject({ value: 0, trendPct: -100 });
  });

  it("honours tenant targets and direction for status", () => {
    const k = Object.fromEntries(
      buildKpis(AGGS, ADMIN, { "visitor.overstay_rate_pct": { target: 6, owner: "CISO" }, "court.disposals_per_registration_pct": { target: 50 } }).map((x) => [x.key, x]),
    );
    expect(k["visitor.overstay_rate_pct"]).toMatchObject({ status: "on_target", owner: "CISO", target: 6 });
    expect(k["court.disposals_per_registration_pct"].status).toBe("off_target");
  });

  it("D10: module roles see only their module; reader-only sees none; admin sees all", () => {
    const fin = buildKpis(AGGS, ["analytics_viewer", "finance_officer"]);
    expect(fin.length).toBeGreaterThan(0);
    expect(fin.every((x) => x.module === "finance")).toBe(true);
    expect(buildKpis(AGGS, ["analytics_viewer"])).toEqual([]);
    const all = new Set(buildKpis(AGGS, ["tenant_admin"]).map((x) => x.module));
    expect(all).toEqual(new Set(["finance", "visitor", "court"]));
  });

  it("canSeeModule + catalog sanity", () => {
    expect(canSeeModule(["court_admin"], "court")).toBe(true);
    expect(canSeeModule(["court_admin"], "finance")).toBe(false);
    expect(new Set(KPI_DEFS.map((d) => d.key)).size).toBe(KPI_DEFS.length);
    expect(formatKpiValue(12.5, "percent")).toBe("12.5%");
  });
});
