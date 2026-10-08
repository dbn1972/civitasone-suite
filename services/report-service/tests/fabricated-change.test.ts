/**
 * GAP2-REPORTS-DASHBOARD-01 + GAP2-REPORTS-MIS-01
 *
 * The reports dashboard and MIS summary used to fabricate a per-KPI
 * period-over-period change with NO backing data:
 *   dashboard: changePct = achievementPct >= 100 ? 5 : -3
 *   mis:       change    = trend === "up" ? "+5%" : trend === "down" ? "-3%" : "0%"
 * These are invented numbers presented to executives / department users as
 * real movement. The KPI row carries no prior-period value, so there is no
 * honest delta to compute. The fix omits them entirely.
 *
 * These assertions FAIL on the old code (which emitted 5 / "+5%").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KpiRow } from "../src/modules/kpis/schema.js";

// Pass-through cache so the queries hit the (mocked) repo directly.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...a: string[]) => a.join(":"),
  },
  queue: { publish: async () => {} },
}));

const mockState = vi.hoisted(() => ({ rows: [] as KpiRow[] }));
vi.mock("../src/modules/kpis/repo.js", () => ({
  listByTenant: async () => mockState.rows,
}));

const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "11111111-1111-1111-1111-111111111111";

function kpi(over: Partial<KpiRow> = {}): KpiRow {
  return {
    id: "kpi-1",
    tenantId: TENANT,
    kpiName: "Collections",
    module: "revenue",
    targetValue: "100" as unknown as KpiRow["targetValue"],
    currentValue: "120" as unknown as KpiRow["currentValue"],
    unit: "₹",
    period: "FY25",
    trend: "up",
    status: "on_track",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...over,
  } as KpiRow;
}

beforeEach(() => { mockState.rows = []; });

describe("GAP2-REPORTS-DASHBOARD-01: no fabricated changePct", () => {
  it("a KPI with achievementPct=120 does NOT emit changePct: 5", async () => {
    mockState.rows = [kpi({ targetValue: "100" as unknown as KpiRow["targetValue"], currentValue: "120" as unknown as KpiRow["currentValue"], trend: "up" })];
    const { listDashboardItems } = await import("../src/modules/kpis/queries.js");
    const items = await listDashboardItems(TENANT, 10);
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("changePct");
    // the real stored trend still drives the direction (no fabricated magnitude)
    expect(items[0].changeDirection).toBe("up");
  });

  it("a below-target KPI does NOT emit changePct: -3", async () => {
    mockState.rows = [kpi({ currentValue: "50" as unknown as KpiRow["currentValue"], trend: "down" })];
    const { listDashboardItems } = await import("../src/modules/kpis/queries.js");
    const items = await listDashboardItems(TENANT, 10);
    expect(items[0]).not.toHaveProperty("changePct");
    expect(items[0].changeDirection).toBe("down");
  });
});

describe("GAP2-REPORTS-MIS-01: no fabricated change string", () => {
  it("an up-trend KPI does NOT emit the literal \"+5%\"", async () => {
    mockState.rows = [kpi({ trend: "up" })];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const groups = await listMisSummary(TENANT, 10);
    const metric = groups[0].metrics[0];
    expect(metric).not.toHaveProperty("change");
    expect(JSON.stringify(groups)).not.toContain("+5%");
  });

  it("a down-trend KPI does NOT emit the literal \"-3%\"", async () => {
    mockState.rows = [kpi({ trend: "down" })];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const groups = await listMisSummary(TENANT, 10);
    expect(JSON.stringify(groups)).not.toContain("-3%");
  });
});
