/**
 * Tests for scheduled/cron.ts tick() function and kpis/queries + mis/queries.
 * Covers the cron sweep logic and KPI/MIS data transformation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000001";

// ─── Mock state ────────────────────────────────────────────────────
const mockState = vi.hoisted(() => ({
  selectResult: [] as Record<string, unknown>[],
  updateCalls: [] as Record<string, unknown>[],
  publishCalls: [] as { topic: string; msg: unknown }[],
}));

// ─── DB Mock for cron ──────────────────────────────────────────────
vi.mock("../src/shared/db.js", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (n: number) => mockState.selectResult.slice(0, n),
    offset: () => mockState.selectResult,
  };
  return {
    db: {
      select: () => chain,
      update: () => ({
        set: (data: Record<string, unknown>) => {
          mockState.updateCalls.push(data);
          return { where: () => ({ returning: () => [{}] }) };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        select: () => chain,
        update: () => ({
          set: (data: Record<string, unknown>) => {
            mockState.updateCalls.push(data);
            return { where: () => ({ returning: () => [{}] }) };
          },
        }),
      }),
    },
    sqlClient: { end: async () => {} },
  };
});

// ─── Infra Mock ────────────────────────────────────────────────────
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_tid: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateResource: async () => {},
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: {
    publish: async (topic: string, msg: unknown) => { mockState.publishCalls.push({ topic, msg }); },
    subscribe: () => {},
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => true,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: (...args: unknown[]) => args,
  lte: () => "lte",
  desc: () => "desc",
  sql: () => "sql",
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    createJob: "reports.job.create",
    renderJob: "reports.job.render",
    scheduledGenerate: "reports.scheduled.generate",
  },
  EVENTS: {
    scheduledGenerated: "reports.scheduled.generated",
    scheduledDelivered: "reports.scheduled.delivered",
  },
  SERVICE: "reports",
  RESOURCE: "job",
}));

vi.mock("@civitasone/events", () => ({
  NOTIFICATION_SEND: "notification.send",
  buildNotificationPayload: (opts: Record<string, unknown>) => opts,
}));

// ─── KPIs repo mock ───────────────────────────────────────────────
vi.mock("../src/modules/kpis/repo.js", () => ({
  listByTenant: async () => mockState.selectResult,
}));

beforeEach(() => {
  mockState.selectResult = [];
  mockState.updateCalls = [];
  mockState.publishCalls = [];
});

// ═══════════════════════════════════════════════════════════════════
// 1. Scheduled Cron — tick()
// ═══════════════════════════════════════════════════════════════════
describe("tick()", () => {
  it("returns 0 when no due reports", async () => {
    mockState.selectResult = [];
    const { tick } = await import("../src/modules/scheduled/cron.js");
    const dispatched = await tick();
    expect(dispatched).toBe(0);
  });

  it("dispatches render jobs for due reports and updates nextRunAt", async () => {
    mockState.selectResult = [
      {
        id: "sched-1",
        tenantId: TENANT_ID,
        templateId: "tmpl-1",
        cadence: "daily",
        recipients: ["admin@gov.in"],
        format: "pdf",
        enabled: true,
        nextRunAt: new Date("2020-01-01"),
        lastRunAt: null,
      },
    ];
    const { tick } = await import("../src/modules/scheduled/cron.js");
    const dispatched = await tick();
    expect(dispatched).toBe(1);
    // Should have published renderJob command
    const renderPub = mockState.publishCalls.find((p) => p.topic === "reports.job.render");
    expect(renderPub).toBeDefined();
    // Should have published notification
    const notifyPub = mockState.publishCalls.find((p) => p.topic === "notification.send");
    expect(notifyPub).toBeDefined();
    // Should have updated nextRunAt
    expect(mockState.updateCalls.length).toBeGreaterThan(0);
    const updateWithNextRun = mockState.updateCalls.find((u) => u.nextRunAt !== undefined);
    expect(updateWithNextRun).toBeDefined();
  });

  it("dispatches for multiple due reports", async () => {
    mockState.selectResult = [
      {
        id: "sched-2",
        tenantId: TENANT_ID,
        templateId: "tmpl-2",
        cadence: "weekly",
        recipients: ["a@b.com", "c@d.com"],
        format: "xlsx",
        enabled: true,
        nextRunAt: new Date("2020-01-01"),
        lastRunAt: null,
      },
      {
        id: "sched-3",
        tenantId: TENANT_ID,
        templateId: "tmpl-3",
        cadence: "hourly",
        recipients: ["x@y.com"],
        format: "csv",
        enabled: true,
        nextRunAt: new Date("2020-01-01"),
        lastRunAt: null,
      },
    ];
    const { tick } = await import("../src/modules/scheduled/cron.js");
    const dispatched = await tick();
    expect(dispatched).toBe(2);
  });

  it("handles error in dispatch gracefully (logs error, continues)", async () => {
    // Force publish to throw for the first call
    const origPush = mockState.publishCalls.push.bind(mockState.publishCalls);
    let callCount = 0;
    vi.spyOn(mockState.publishCalls, "push").mockImplementation((...args) => {
      callCount++;
      if (callCount === 1) throw new Error("publish failed");
      return origPush(...args);
    });

    mockState.selectResult = [
      {
        id: "sched-err",
        tenantId: TENANT_ID,
        templateId: "tmpl-err",
        cadence: "daily",
        recipients: ["fail@test.com"],
        format: "pdf",
        enabled: true,
        nextRunAt: new Date("2020-01-01"),
        lastRunAt: null,
      },
    ];
    const { tick } = await import("../src/modules/scheduled/cron.js");
    // Should not throw
    const dispatched = await tick();
    expect(dispatched).toBe(0); // Failed to dispatch
    vi.restoreAllMocks();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. KPI Queries
// ═══════════════════════════════════════════════════════════════════
describe("kpis/queries — listKpis", () => {
  it("maps KPI rows with correct achievement calculation", async () => {
    mockState.selectResult = [
      {
        id: "kpi-1",
        kpiName: "Budget Utilization",
        module: "finance",
        targetValue: "1000",
        currentValue: "750",
        unit: "INR lakhs",
        period: "Q1 2026",
        trend: "up",
        status: "on_track",
        createdAt: new Date(),
      },
    ];
    const { listKpis } = await import("../src/modules/kpis/queries.js");
    const result = await listKpis(TENANT_ID, 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.kpiName).toBe("Budget Utilization");
    expect(result[0]!.achievementPct).toBe(75);
    expect(result[0]!.trend).toBe("up");
    expect(result[0]!.status).toBe("on_track");
  });

  it("handles zero target value (achievementPct = 0)", async () => {
    mockState.selectResult = [
      {
        id: "kpi-2",
        kpiName: "Zero Target",
        module: "hrms",
        targetValue: "0",
        currentValue: "50",
        unit: "count",
        period: "Q2 2026",
        trend: "stable",
        status: "at_risk",
        createdAt: new Date(),
      },
    ];
    const { listKpis } = await import("../src/modules/kpis/queries.js");
    const result = await listKpis(TENANT_ID, 10);
    expect(result[0]!.achievementPct).toBe(0);
    expect(result[0]!.status).toBe("at_risk");
    expect(result[0]!.trend).toBe("stable");
  });

  it("maps down trend and off_track status", async () => {
    mockState.selectResult = [
      {
        id: "kpi-3",
        kpiName: "Revenue",
        module: "finance",
        targetValue: "500",
        currentValue: "100",
        unit: "crore",
        period: "FY26",
        trend: "down",
        status: "off_track",
        createdAt: new Date(),
      },
    ];
    const { listKpis } = await import("../src/modules/kpis/queries.js");
    const result = await listKpis(TENANT_ID, 10);
    expect(result[0]!.trend).toBe("down");
    expect(result[0]!.status).toBe("off_track");
    expect(result[0]!.achievementPct).toBe(20);
  });

  it("returns empty array when no KPIs", async () => {
    mockState.selectResult = [];
    const { listKpis } = await import("../src/modules/kpis/queries.js");
    const result = await listKpis(TENANT_ID, 10);
    expect(result).toEqual([]);
  });
});

describe("kpis/queries — listDashboardItems", () => {
  it("transforms KPIs into dashboard items", async () => {
    mockState.selectResult = [
      {
        id: "kpi-d1",
        kpiName: "Tickets Resolved",
        module: "helpdesk",
        targetValue: "100",
        currentValue: "110",
        unit: "count",
        period: "July 2026",
        trend: "up",
        status: "on_track",
        createdAt: new Date(),
      },
    ];
    const { listDashboardItems } = await import("../src/modules/kpis/queries.js");
    const items = await listDashboardItems(TENANT_ID, 10);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Tickets Resolved");
    expect(items[0]!.module).toBe("helpdesk");
    expect(items[0]!.changeDirection).toBe("up");
    // achievementPct is 110 which is >=100, so changePct should be 5
    expect(items[0]!.changePct).toBe(5);
  });

  it("shows negative change for underperformers", async () => {
    mockState.selectResult = [
      {
        id: "kpi-d2",
        kpiName: "Response Time",
        module: "crm",
        targetValue: "200",
        currentValue: "50",
        unit: "ms",
        period: "July 2026",
        trend: "down",
        status: "off_track",
        createdAt: new Date(),
      },
    ];
    const { listDashboardItems } = await import("../src/modules/kpis/queries.js");
    const items = await listDashboardItems(TENANT_ID, 10);
    expect(items[0]!.changePct).toBe(-3);
    expect(items[0]!.changeDirection).toBe("down");
  });

  it("shows neutral for stable trend", async () => {
    mockState.selectResult = [
      {
        id: "kpi-d3",
        kpiName: "Steady KPI",
        module: "asset",
        targetValue: "100",
        currentValue: "100",
        unit: "%",
        period: "July 2026",
        trend: "stable",
        status: "on_track",
        createdAt: new Date(),
      },
    ];
    const { listDashboardItems } = await import("../src/modules/kpis/queries.js");
    const items = await listDashboardItems(TENANT_ID, 10);
    expect(items[0]!.changeDirection).toBe("neutral");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. MIS Queries
// ═══════════════════════════════════════════════════════════════════
describe("mis/queries — listMisSummary", () => {
  it("groups KPIs by module and returns MIS summary", async () => {
    mockState.selectResult = [
      {
        id: "kpi-m1",
        kpiName: "Bills Processed",
        module: "finance",
        targetValue: "1000",
        currentValue: "800",
        unit: "count",
        period: "Q1",
        trend: "up",
        status: "on_track",
        createdAt: new Date(),
      },
      {
        id: "kpi-m2",
        kpiName: "Vouchers",
        module: "finance",
        targetValue: "500",
        currentValue: "450",
        unit: "count",
        period: "Q1",
        trend: "stable",
        status: "on_track",
        createdAt: new Date(),
      },
      {
        id: "kpi-m3",
        kpiName: "Employees Onboarded",
        module: "hrms",
        targetValue: "50",
        currentValue: "48",
        unit: "count",
        period: "Q1",
        trend: "up",
        status: "on_track",
        createdAt: new Date(),
      },
    ];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const result = await listMisSummary(TENANT_ID, 10);
    expect(result.length).toBe(2); // Two modules: finance, hrms

    const financeGroup = result.find((r) => r.module === "finance");
    expect(financeGroup).toBeDefined();
    expect(financeGroup!.metrics).toHaveLength(2);
    expect(financeGroup!.metrics[0]!.label).toBe("Bills Processed");
    // trend is "up" so change should be "+5%"
    expect(financeGroup!.metrics[0]!.change).toBe("+5%");

    const hrmsGroup = result.find((r) => r.module === "hrms");
    expect(hrmsGroup).toBeDefined();
    expect(hrmsGroup!.metrics).toHaveLength(1);
  });

  it("returns empty array when no KPIs", async () => {
    mockState.selectResult = [];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const result = await listMisSummary(TENANT_ID, 10);
    expect(result).toEqual([]);
  });

  it("handles down trend with -3% change", async () => {
    mockState.selectResult = [
      {
        id: "kpi-m4",
        kpiName: "Attendance Rate",
        module: "hrms",
        targetValue: "100",
        currentValue: "85",
        unit: "%",
        period: "Q1",
        trend: "down",
        status: "at_risk",
        createdAt: new Date(),
      },
    ];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const result = await listMisSummary(TENANT_ID, 10);
    expect(result[0]!.metrics[0]!.change).toBe("-3%");
  });

  it("handles stable trend with 0% change", async () => {
    mockState.selectResult = [
      {
        id: "kpi-m5",
        kpiName: "Inventory Level",
        module: "inventory",
        targetValue: "1000",
        currentValue: "1000",
        unit: "items",
        period: "Q1",
        trend: "stable",
        status: "on_track",
        createdAt: new Date(),
      },
    ];
    const { listMisSummary } = await import("../src/modules/mis/queries.js");
    const result = await listMisSummary(TENANT_ID, 10);
    expect(result[0]!.metrics[0]!.change).toBe("0%");
  });
});
