/**
 * GAP-HR-TRAINING-NEW-01/NEW-02 — training consumer unit tests.
 *
 * Mocked DB/outbox/cache, matching the established style for this service's
 * consumer tests (see leave/consumer.test.ts). Covers:
 *  - trainingCreate passes category/mode/enrollmentDeadline through to
 *    repo.insertTraining (null when the form left them unset, never a
 *    guessed default).
 *  - trainingCreate invalidates the tenant's cached training list so a
 *    freshly created programme is visible immediately, not after the
 *    cache's TTL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { dbTransactionFn, insertTrainingMock, invalidateResourceMock, enqueueMock, markProcessedMock } = vi.hoisted(() => {
  const _mockTx = {};
  return {
    dbTransactionFn: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb(_mockTx);
    }),
    insertTrainingMock: vi.fn().mockResolvedValue(undefined),
    invalidateResourceMock: vi.fn().mockResolvedValue(undefined),
    enqueueMock: vi.fn().mockResolvedValue(undefined),
    markProcessedMock: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: enqueueMock,
  markProcessed: markProcessedMock,
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidateResource: invalidateResourceMock },
}));
vi.mock("./repo.js", () => ({
  insertTraining: insertTrainingMock,
  insertNomination: vi.fn(),
  completeNomination: vi.fn(),
}));
vi.mock("../service-book/schema.js", () => ({ hrmsServiceBookEntries: {} }));

const { registerTrainingConsumers } = await import("./consumer.js");
const { COMMANDS } = await import("../../topics.js");

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: (payload.tenantId as string) ?? "tenant-1",
    actorId: "actor-1",
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerTrainingConsumers(q);
  await q.start();
  return q;
}

describe("training consumer — trainingCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
  });

  it("passes category/mode/enrollmentDeadline through to repo.insertTraining", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.trainingCreate,
      makeMsg(COMMANDS.trainingCreate, {
        id: "training-1",
        tenantId: "tenant-1",
        title: "Advanced Excel",
        fromDate: "2026-11-01",
        toDate: "2026-11-02",
        maxParticipants: 30,
        category: "optional",
        mode: "online",
        enrollmentDeadline: "2026-10-25",
      }),
    );
    await settle();

    expect(insertTrainingMock).toHaveBeenCalledTimes(1);
    const row = insertTrainingMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.category).toBe("optional");
    expect(row.mode).toBe("online");
    expect(row.enrollmentDeadline).toBe("2026-10-25");
    await q.stop();
  });

  it("defaults category/mode/enrollmentDeadline to null, never a guessed value, when the form left them unset", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.trainingCreate,
      makeMsg(COMMANDS.trainingCreate, {
        id: "training-2",
        tenantId: "tenant-1",
        title: "Unspecified Category Training",
        fromDate: "2026-11-01",
        toDate: "2026-11-02",
        maxParticipants: 30,
      }),
    );
    await settle();

    const row = insertTrainingMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.category).toBeNull();
    expect(row.mode).toBeNull();
    expect(row.enrollmentDeadline).toBeNull();
    await q.stop();
  });

  it("invalidates the tenant's cached training list after a successful create", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.trainingCreate,
      makeMsg(COMMANDS.trainingCreate, {
        id: "training-3",
        tenantId: "tenant-42",
        title: "Cache Invalidation Check",
        fromDate: "2026-11-01",
        toDate: "2026-11-02",
        maxParticipants: 30,
      }),
    );
    await settle();

    expect(invalidateResourceMock).toHaveBeenCalledWith("tenant-42", "training");
    await q.stop();
  });
});
