/**
 * Feature Store Domain Tests — covers getFeatureVector, computeAndCache, batchRefresh
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRows = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("../src/shared/db.js", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => {
      const r = Object.assign([...mockRows.rows], { limit: () => mockRows.rows });
      return r;
    };
    c.limit = () => mockRows.rows;
    return c;
  };
  return {
    db: {
      select: chain,
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => {} }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: chain,
          insert: () => ({ values: () => ({ onConflictDoUpdate: () => {} }) }),
        };
        return fn(tx);
      },
    },
    sqlClient: {},
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_key: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
  },
  queue: { publish: async () => {} },
}));

describe("Feature Store Domain", () => {
  const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
  const ENTITY = "bbbbbbbb-2222-4000-8000-000000000001";

  beforeEach(() => {
    mockRows.rows = [];
  });

  it("exports FEATURE_DEFINITIONS with all 6 domains", async () => {
    const { FEATURE_DEFINITIONS } = await import("../src/modules/feature-store/domain.js");
    expect(Object.keys(FEATURE_DEFINITIONS)).toHaveLength(6);
    expect(FEATURE_DEFINITIONS.leads).toContain("daysInStage");
    expect(FEATURE_DEFINITIONS.tickets).toContain("category");
    expect(FEATURE_DEFINITIONS.inventory).toContain("avgDailyMovement30d");
    expect(FEATURE_DEFINITIONS.subscriptions).toContain("daysSinceLastLogin");
    expect(FEATURE_DEFINITIONS.tasks).toContain("spiHistory5");
    expect(FEATURE_DEFINITIONS.transactions).toContain("amountPaise");
  });

  it("getFeatureVector returns null when no data", async () => {
    mockRows.rows = [];
    const { getFeatureVector } = await import("../src/modules/feature-store/domain.js");
    const result = await getFeatureVector(TENANT, "leads", ENTITY);
    expect(result).toBeNull();
  });

  it("getFeatureVector returns vector when data exists", async () => {
    mockRows.rows = [{
      tenantId: TENANT,
      domain: "leads",
      entityId: ENTITY,
      features: { daysInStage: 5, interactionCount: 10 },
      computedAt: new Date("2024-01-01"),
    }];
    const { getFeatureVector } = await import("../src/modules/feature-store/domain.js");
    const result = await getFeatureVector(TENANT, "leads", ENTITY);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("leads");
    expect(result!.entityId).toBe(ENTITY);
  });

  it("computeAndCache produces feature vector with domain features", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "leads", ENTITY);
    expect(result.tenantId).toBe(TENANT);
    expect(result.domain).toBe("leads");
    expect(result.entityId).toBe(ENTITY);
    expect(result.features).toBeDefined();
    expect(Object.keys(result.features).length).toBeGreaterThan(0);
    expect(result.computedAt).toBeInstanceOf(Date);
  });

  it("computeAndCache sets categorical features to 'unknown'", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "leads", ENTITY);
    expect(result.features.sourceChannel).toBe("unknown");
  });

  it("computeAndCache sets numeric features to 0", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "leads", ENTITY);
    expect(result.features.daysInStage).toBe(0);
    expect(result.features.interactionCount).toBe(0);
  });

  it("batchRefresh processes all existing entities", async () => {
    mockRows.rows = [{ entityId: "e1" }, { entityId: "e2" }, { entityId: "e3" }];
    const { batchRefresh } = await import("../src/modules/feature-store/domain.js");
    const count = await batchRefresh(TENANT, "leads");
    expect(count).toBe(3);
  });

  it("batchRefresh returns 0 when no entities", async () => {
    mockRows.rows = [];
    const { batchRefresh } = await import("../src/modules/feature-store/domain.js");
    const count = await batchRefresh(TENANT, "tickets");
    expect(count).toBe(0);
  });

  it("computeAndCache works for tickets domain", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "tickets", ENTITY);
    expect(result.features.category).toBe("unknown");
    expect(result.features.priority).toBe("unknown");
    expect(result.features.assigneeWorkload).toBe(0);
  });

  it("computeAndCache works for transactions domain", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "transactions", ENTITY);
    expect(result.features.categoryId).toBe("unknown");
    expect(result.features.vendorId).toBe("unknown");
    expect(result.features.amountPaise).toBe(0);
  });

  it("computeAndCache works for inventory domain", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "inventory", ENTITY);
    expect(result.features.avgDailyMovement30d).toBe(0);
    expect(result.features.leadTimeDays).toBe(0);
  });

  it("computeAndCache works for subscriptions domain", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "subscriptions", ENTITY);
    expect(result.features.daysSinceLastLogin).toBe(0);
    expect(result.features.tenureDays).toBe(0);
  });

  it("computeAndCache works for tasks domain", async () => {
    const { computeAndCache } = await import("../src/modules/feature-store/domain.js");
    const result = await computeAndCache(TENANT, "tasks", ENTITY);
    expect(result.features.spiHistory5).toBe(0);
    expect(result.features.criticalPathFlag).toBe(0);
  });

  it("featureStore port exports all methods", async () => {
    const { featureStore } = await import("../src/modules/feature-store/domain.js");
    expect(featureStore.getFeatureVector).toBeTypeOf("function");
    expect(featureStore.computeAndCache).toBeTypeOf("function");
    expect(featureStore.batchRefresh).toBeTypeOf("function");
  });
});
