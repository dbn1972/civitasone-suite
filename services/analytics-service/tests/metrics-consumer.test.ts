/**
 * Metrics consumer — tests the save metric command handler.
 * Mocks db.transaction to avoid the tenant GUC dependency.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const mockTx = {
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }) }),
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
};

const markProcessedMock = vi.fn().mockResolvedValue(true);
const enqueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: any) => fn(mockTx)) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async (fn: any) => fn(mockTx)),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => markProcessedMock(...args),
  enqueue: (...args: any[]) => enqueueMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidateResource: vi.fn().mockResolvedValue(undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const { MemoryQueue } = await import("@civitasone/queue");
const { COMMANDS } = await import("../src/topics.js");
const { registerMetricsConsumers } = await import("../src/modules/metrics/consumer.js");

const TENANT = randomUUID();
const ACTOR = randomUUID();
let queue: InstanceType<typeof MemoryQueue>;

beforeAll(async () => {
  queue = new MemoryQueue();
  registerMetricsConsumers(queue);
  await queue.start();
});

beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
});

describe("MetricsConsumer — saveMetric", () => {
  it("processes saveMetric command and emits event + audit", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.saveMetric, {
      messageId: id,
      type: COMMANDS.saveMetric,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, name: "Revenue Sum", metricKey: "finance.revenue_sum", spec: { agg: "sum" } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
    // Should emit metricSaved event + audit event
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("skips when markProcessed returns false (idempotent)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const id = randomUUID();
    await queue.publish(COMMANDS.saveMetric, {
      messageId: id,
      type: COMMANDS.saveMetric,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, name: "Dup", metricKey: "dup.key", spec: {} },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
