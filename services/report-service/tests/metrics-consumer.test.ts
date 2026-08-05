/**
 * metrics/consumer.ts tests — the CQRS write path in isolation (db, cache, outbox
 * and repo are mocked, so this exercises the handler logic only).
 *
 * Covers: idempotency (a redelivery is a complete no-op), the audit event landing
 * in the outbox inside the same transaction, cache invalidation of both the id and
 * the by-key entries, and the optimistic-lock-loss branch of every update handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "cccccccc-3333-4000-8000-0000000000c9";
const ACTOR_ID = "cccccccc-3333-4000-8000-000000000001";
const DEF_ID = "eeeeeeee-5555-4000-8000-000000000001";

const mockState = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  markProcessedResult: true,
  markProcessedCalls: [] as string[],
  updateApplied: true,
  enqueueCalls: [] as Record<string, unknown>[],
  cacheInvalidations: [] as string[],
  resourceInvalidations: [] as string[],
  subscriptions: [] as string[],
}));

vi.mock("../src/shared/db.js", () => {
  const tx = { marker: "tx" };
  return {
    db: { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) },
    sqlClient: { end: async () => {} },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (tenantId: string, resource: string, id: string) => `reports:${tenantId}:${resource}:${id}`,
    invalidate: async (key: string) => {
      mockState.cacheInvalidations.push(key);
    },
    invalidateResource: async (tenantId: string, resource: string) => {
      mockState.resourceInvalidations.push(`${tenantId}:${resource}`);
    },
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_t: string, _r: string, _h: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
  },
  queue: { publish: async () => {}, subscribe: () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => {
    mockState.enqueueCalls.push(ev);
  },
  markProcessed: async (_tx: unknown, messageId: string) => {
    mockState.markProcessedCalls.push(messageId);
    return mockState.markProcessedResult;
  },
}));

vi.mock("../src/modules/metrics/repo.js", () => ({
  insert: async (_tx: unknown, row: Record<string, unknown>) => {
    mockState.inserted.push(row);
  },
  updateByVersion: async (
    _tx: unknown,
    id: string,
    tenantId: string,
    version: number,
    data: Record<string, unknown>,
  ) => {
    mockState.updates.push({ id, tenantId, version, data });
    return mockState.updateApplied;
  },
  findById: async () => null,
  findPublishedByKey: async () => null,
  listByTenant: async () => ({ rows: [], total: 0 }),
  maxVersionNumber: async () => 0,
  toView: (r: Record<string, unknown>) => r,
}));

const definitionPayload = {
  id: DEF_ID,
  tenantId: TENANT_ID,
  metricKey: "crm.consumer_test_rate",
  displayName: "Consumer test rate",
  description: null,
  module: "crm",
  unit: "percent",
  aggregation: "ratio",
  numeratorSource: "crm.numerator",
  denominatorSource: "crm.denominator",
  dimensions: ["region"],
  period: "monthly",
  targetValue: null,
  higherIsBetter: true,
  governance: "tenant",
  versionNumber: 1,
  status: "draft",
  version: 1,
};

function envelope<T>(messageId: string, type: string, payload: T) {
  return {
    messageId,
    type,
    tenantId: TENANT_ID,
    actorId: ACTOR_ID,
    correlationId: "corr-metrics-1",
    schemaVersion: "1.0",
    payload,
  };
}

beforeEach(() => {
  mockState.inserted = [];
  mockState.updates = [];
  mockState.markProcessedResult = true;
  mockState.markProcessedCalls = [];
  mockState.updateApplied = true;
  mockState.enqueueCalls = [];
  mockState.cacheInvalidations = [];
  mockState.resourceInvalidations = [];
  mockState.subscriptions = [];
});

describe("handleCreateMetricDefinition", () => {
  it("inserts, emits the domain event and the audit event, then invalidates the cache", async () => {
    const { handleCreateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleCreateMetricDefinition(
      envelope("msg-create-1", "reports.metric_definition.create", definitionPayload),
    );

    expect(mockState.markProcessedCalls).toEqual(["msg-create-1"]);
    expect(mockState.inserted).toHaveLength(1);
    expect(mockState.inserted[0]?.metricKey).toBe("crm.consumer_test_rate");
    expect(mockState.inserted[0]?.createdBy).toBe(ACTOR_ID);

    const topics = mockState.enqueueCalls.map((e) => e.topic);
    expect(topics).toEqual(["reports.metric_definition.created", "audit.event.record"]);
    const audit = mockState.enqueueCalls[1]?.payload as Record<string, unknown>;
    expect(audit).toMatchObject({
      service: "reports",
      action: "metric_definition.create",
      resourceType: "metric_definition",
      resourceId: DEF_ID,
      outcome: "success",
    });

    expect(mockState.cacheInvalidations).toEqual([
      `reports:${TENANT_ID}:metric_definition:${DEF_ID}`,
      `reports:${TENANT_ID}:metric_definition:by-key:crm.consumer_test_rate`,
    ]);
    expect(mockState.resourceInvalidations).toEqual([`${TENANT_ID}:metric_definition`]);
  });

  it("is a no-op on redelivery (markProcessed returns false)", async () => {
    mockState.markProcessedResult = false;
    const { handleCreateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleCreateMetricDefinition(
      envelope("msg-create-1", "reports.metric_definition.create", definitionPayload),
    );

    expect(mockState.inserted).toHaveLength(0);
    expect(mockState.enqueueCalls).toHaveLength(0);
  });
});

describe("handleVersionMetricDefinition", () => {
  it("inserts the new draft and reports the source row it was forked from", async () => {
    const { handleVersionMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleVersionMetricDefinition(
      envelope("msg-version-1", "reports.metric_definition.version", {
        ...definitionPayload,
        versionNumber: 2,
        sourceId: "aaaaaaaa-0000-4000-8000-000000000001",
      }),
    );

    expect(mockState.inserted[0]?.versionNumber).toBe(2);
    expect(mockState.enqueueCalls[0]?.topic).toBe("reports.metric_definition.versioned");
    expect(mockState.enqueueCalls[0]?.payload).toMatchObject({
      sourceId: "aaaaaaaa-0000-4000-8000-000000000001",
      versionNumber: 2,
    });
    expect(mockState.enqueueCalls[1]?.topic).toBe("audit.event.record");
  });

  it("defaults sourceId to null when the command omits it", async () => {
    const { handleVersionMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleVersionMetricDefinition(
      envelope("msg-version-2", "reports.metric_definition.version", definitionPayload),
    );
    expect(mockState.enqueueCalls[0]?.payload).toMatchObject({ sourceId: null });
  });

  it("is a no-op on redelivery", async () => {
    mockState.markProcessedResult = false;
    const { handleVersionMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleVersionMetricDefinition(
      envelope("msg-version-1", "reports.metric_definition.version", definitionPayload),
    );
    expect(mockState.inserted).toHaveLength(0);
    expect(mockState.enqueueCalls).toHaveLength(0);
  });
});

describe("handleUpdateMetricDefinition", () => {
  it("applies the patch under the optimistic lock and audits it", async () => {
    const { handleUpdateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleUpdateMetricDefinition(
      envelope("msg-update-1", "reports.metric_definition.update", {
        id: DEF_ID,
        version: 3,
        patch: { description: "revised", targetValue: "12.5" },
      }),
    );

    expect(mockState.updates).toHaveLength(1);
    expect(mockState.updates[0]).toMatchObject({ id: DEF_ID, tenantId: TENANT_ID, version: 3 });
    expect((mockState.updates[0]?.data as Record<string, unknown>).updatedBy).toBe(ACTOR_ID);
    expect(mockState.enqueueCalls.map((e) => e.topic)).toEqual([
      "reports.metric_definition.updated",
      "audit.event.record",
    ]);
    expect(mockState.cacheInvalidations).toHaveLength(2);
  });

  it("emits nothing when the optimistic lock was lost", async () => {
    mockState.updateApplied = false;
    const { handleUpdateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleUpdateMetricDefinition(
      envelope("msg-update-2", "reports.metric_definition.update", {
        id: DEF_ID,
        version: 99,
        patch: { description: "stale" },
      }),
    );

    expect(mockState.updates).toHaveLength(1);
    expect(mockState.enqueueCalls).toHaveLength(0);
  });

  it("carries a renamed metricKey through to the invalidated by-key entry", async () => {
    const { handleUpdateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleUpdateMetricDefinition(
      envelope("msg-update-3", "reports.metric_definition.update", {
        id: DEF_ID,
        version: 1,
        patch: { metricKey: "crm.renamed_rate" },
      }),
    );
    expect(mockState.cacheInvalidations).toContain(
      `reports:${TENANT_ID}:metric_definition:by-key:crm.renamed_rate`,
    );
  });

  it("is a no-op on redelivery", async () => {
    mockState.markProcessedResult = false;
    const { handleUpdateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleUpdateMetricDefinition(
      envelope("msg-update-1", "reports.metric_definition.update", {
        id: DEF_ID,
        version: 3,
        patch: { description: "revised" },
      }),
    );
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.enqueueCalls).toHaveLength(0);
  });
});

describe("handlePublishMetricDefinition", () => {
  it("stamps publishedAt, emits the published event and audits it", async () => {
    const { handlePublishMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handlePublishMetricDefinition(
      envelope("msg-publish-1", "reports.metric_definition.publish", {
        id: DEF_ID,
        version: 1,
        metricKey: "crm.consumer_test_rate",
      }),
    );

    const data = mockState.updates[0]?.data as Record<string, unknown>;
    expect(data.status).toBe("published");
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(mockState.enqueueCalls[0]?.topic).toBe("reports.metric_definition.published");
    expect(mockState.enqueueCalls[1]?.topic).toBe("audit.event.record");
    expect(mockState.cacheInvalidations).toContain(
      `reports:${TENANT_ID}:metric_definition:by-key:crm.consumer_test_rate`,
    );
  });

  it("emits nothing when the optimistic lock was lost", async () => {
    mockState.updateApplied = false;
    const { handlePublishMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handlePublishMetricDefinition(
      envelope("msg-publish-2", "reports.metric_definition.publish", {
        id: DEF_ID,
        version: 1,
        metricKey: "crm.consumer_test_rate",
      }),
    );
    expect(mockState.enqueueCalls).toHaveLength(0);
  });

  it("is a no-op on redelivery", async () => {
    mockState.markProcessedResult = false;
    const { handlePublishMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handlePublishMetricDefinition(
      envelope("msg-publish-1", "reports.metric_definition.publish", {
        id: DEF_ID,
        version: 1,
        metricKey: "crm.consumer_test_rate",
      }),
    );
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.enqueueCalls).toHaveLength(0);
  });
});

describe("handleDeprecateMetricDefinition", () => {
  it("stamps deprecatedAt and emits the deprecated event", async () => {
    const { handleDeprecateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleDeprecateMetricDefinition(
      envelope("msg-deprecate-1", "reports.metric_definition.deprecate", {
        id: DEF_ID,
        version: 4,
        metricKey: "crm.consumer_test_rate",
      }),
    );

    const data = mockState.updates[0]?.data as Record<string, unknown>;
    expect(data.status).toBe("deprecated");
    expect(data.deprecatedAt).toBeInstanceOf(Date);
    expect(mockState.enqueueCalls.map((e) => e.topic)).toEqual([
      "reports.metric_definition.deprecated",
      "audit.event.record",
    ]);
  });

  it("emits nothing when the optimistic lock was lost", async () => {
    mockState.updateApplied = false;
    const { handleDeprecateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleDeprecateMetricDefinition(
      envelope("msg-deprecate-2", "reports.metric_definition.deprecate", {
        id: DEF_ID,
        version: 4,
        metricKey: "crm.consumer_test_rate",
      }),
    );
    expect(mockState.enqueueCalls).toHaveLength(0);
  });

  it("is a no-op on redelivery", async () => {
    mockState.markProcessedResult = false;
    const { handleDeprecateMetricDefinition } = await import("../src/modules/metrics/consumer.js");
    await handleDeprecateMetricDefinition(
      envelope("msg-deprecate-1", "reports.metric_definition.deprecate", {
        id: DEF_ID,
        version: 4,
        metricKey: "crm.consumer_test_rate",
      }),
    );
    expect(mockState.updates).toHaveLength(0);
  });
});

describe("registerMetricConsumers", () => {
  it("subscribes to all five metric definition command topics", async () => {
    const { registerMetricConsumers } = await import("../src/modules/metrics/consumer.js");
    const handlers = new Map<string, (msg: unknown) => Promise<void>>();
    const mockQueue = {
      subscribe: (topic: string, handler: (msg: unknown) => Promise<void>) => {
        mockState.subscriptions.push(topic);
        handlers.set(topic, handler);
      },
      publish: async () => "",
      start: async () => {},
      stop: async () => {},
      healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
    };

    registerMetricConsumers(mockQueue as never);

    expect(mockState.subscriptions).toEqual([
      "reports.metric_definition.create",
      "reports.metric_definition.version",
      "reports.metric_definition.update",
      "reports.metric_definition.publish",
      "reports.metric_definition.deprecate",
    ]);

    // The registered handler is wired to the real logic, not just recorded.
    await handlers.get("reports.metric_definition.create")!(
      envelope("msg-registered-1", "reports.metric_definition.create", definitionPayload),
    );
    expect(mockState.inserted).toHaveLength(1);
    expect(mockState.enqueueCalls.map((e) => e.topic)).toContain("audit.event.record");
  });
});
