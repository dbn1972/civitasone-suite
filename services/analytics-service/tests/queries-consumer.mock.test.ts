/**
 * Queries consumer — mocked DB tests for the run/schedule command handlers.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const mockTx = {
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }) }),
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
        groupBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
      groupBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    }),
  }),
};

const markProcessedMock = vi.fn().mockResolvedValue(true);
const enqueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn(mockTx)),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          groupBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
  },
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
    put: vi.fn().mockResolvedValue(undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const { MemoryQueue } = await import("@civitasone/queue");
const { COMMANDS } = await import("../src/topics.js");
const { registerQueriesConsumers } = await import("../src/modules/queries/consumer.js");

const TENANT = randomUUID();
const ACTOR = randomUUID();
let queue: InstanceType<typeof MemoryQueue>;

beforeAll(async () => {
  queue = new MemoryQueue();
  registerQueriesConsumers(queue);
  await queue.start();
});

beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
});

describe("QueriesConsumer — runQuery", () => {
  it("processes runQuery command and marks as failed for invalid spec", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.runQuery, {
      messageId: id,
      type: COMMANDS.runQuery,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id,
        dashboardId: null,
        queryName: "test",
        status: "queued",
        kind: "adhoc",
        spec: { metric: "INVALID_METRIC", dimensions: [], filters: [], limit: 100 },
        result: null,
        resultRows: 0,
        error: null,
        version: 1,
      },
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(markProcessedMock).toHaveBeenCalled();
  });

  it("skips when markProcessed returns false", async () => {
    markProcessedMock.mockResolvedValue(false);
    const id = randomUUID();
    await queue.publish(COMMANDS.runQuery, {
      messageId: id,
      type: COMMANDS.runQuery,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, dashboardId: null, queryName: "q", status: "queued", kind: "adhoc", spec: {}, result: null, resultRows: 0, error: null, version: 1 },
    });
    await new Promise((r) => setTimeout(r, 50));
    // enqueue should still not be called (markProcessed returned false → early return)
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("QueriesConsumer — scheduleQuery", () => {
  it("processes scheduleQuery command", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.scheduleQuery, {
      messageId: id,
      type: COMMANDS.scheduleQuery,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, name: "daily-report", spec: { metric: "event_count", dimensions: [], filters: [], limit: 50 }, cadence: "daily", enabled: true },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalled();
  });
});
