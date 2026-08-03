/**
 * Experiments consumer wiring — CQRS Batch 3.
 * Ensures experiment create/end commands are registered in worker and applied idempotently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Queue } from "@civitasone/queue";

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn();
const mockRecordConsumerMessage = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{
    id: "exp-1",
    tenantId: "tenant-1",
    domain: "leads",
    status: "completed",
  }]),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      insert: (...args: unknown[]) => mockInsert(...args),
      update: () => mockUpdateChain,
    }),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

vi.mock("../src/modules/observability/metrics.js", () => ({
  recordConsumerMessage: (...args: unknown[]) => mockRecordConsumerMessage(...args),
}));

import { registerExperimentConsumers } from "../src/modules/experiments/consumer.js";
import { COMMANDS } from "../src/topics.js";

describe("experiments consumer registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockUpdateChain.returning.mockResolvedValue([{
      id: "exp-1",
      tenantId: "tenant-1",
      domain: "leads",
      status: "completed",
    }]);
  });

  it("worker.ts registers registerExperimentConsumers(queue)", () => {
    const workerSrc = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(workerSrc).toMatch(/import\s+\{\s*registerExperimentConsumers\s*\}/);
    expect(workerSrc).toContain("registerExperimentConsumers(queue)");
  });

  it("subscribes to ml.experiment.create and ml.experiment.end", () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

    registerExperimentConsumers(mockQueue);

    const topics = mockSubscribe.mock.calls.map((c) => c[0] as string);
    expect(topics).toContain(COMMANDS.experimentCreate);
    expect(topics).toContain(COMMANDS.experimentEnd);
  });

  it("experiment create inserts row and enqueues audit", async () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerExperimentConsumers(mockQueue);

    const createHandler = mockSubscribe.mock.calls.find((c) => c[0] === COMMANDS.experimentCreate)?.[1];
    expect(createHandler).toBeDefined();

    await createHandler!({
      messageId: "msg-create-1",
      type: COMMANDS.experimentCreate,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-1",
      payload: {
        id: "exp-1",
        tenantId: "tenant-1",
        domain: "leads",
        name: "Lead test",
        challengerModelId: "model-a",
        currentModelId: "model-b",
        splitPct: 50,
      },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith(expect.anything(), "msg-create-1");
    expect(mockInsert).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topic: "audit.event.record",
        payload: expect.objectContaining({
          service: "ml",
          action: "experiment.created",
          resourceType: "ml-experiment",
          resourceId: "exp-1",
        }),
      }),
    );
  });

  it("experiment end updates row and enqueues audit", async () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerExperimentConsumers(mockQueue);

    const endHandler = mockSubscribe.mock.calls.find((c) => c[0] === COMMANDS.experimentEnd)?.[1];
    expect(endHandler).toBeDefined();

    await endHandler!({
      messageId: "msg-end-1",
      type: COMMANDS.experimentEnd,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-2",
      payload: { id: "exp-1", tenantId: "tenant-1", status: "completed" },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith(expect.anything(), "msg-end-1");
    expect(mockUpdateChain.set).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          action: "experiment.ended",
          resourceId: "exp-1",
        }),
      }),
    );
  });

  it("skips duplicate experiment create via markProcessed", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerExperimentConsumers(mockQueue);

    const createHandler = mockSubscribe.mock.calls.find((c) => c[0] === COMMANDS.experimentCreate)?.[1];
    await createHandler!({
      messageId: "dup-msg",
      type: COMMANDS.experimentCreate,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "corr-3",
      payload: {
        id: "exp-dup",
        tenantId: "tenant-1",
        domain: "leads",
        name: "Dup",
        challengerModelId: "model-a",
        currentModelId: "model-b",
        splitPct: 50,
      },
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
