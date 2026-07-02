/**
 * Training consumer unit tests — mock-based.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertTrainingMock, insertNominationMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertTrainingMock: vi.fn(async () => undefined),
    insertNominationMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/training/repo.js", () => ({
  insertTraining: (...a: any[]) => insertTrainingMock(...a),
  insertNomination: (...a: any[]) => insertNominationMock(...a),
}));

import { registerTrainingConsumers } from "../src/modules/training/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => { vi.clearAllMocks(); enqueuedMessages.length = 0; dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); }); });

describe("trainingCreate command", () => {
  it("inserts training with status 'planned'", async () => {
    const q = new MemoryQueue(); registerTrainingConsumers(q); await q.start();
    await q.publish(COMMANDS.trainingCreate, makeMsg(COMMANDS.trainingCreate, {
      id: randomUUID(), tenantId: TENANT, title: "Leadership 101",
      fromDate: "2026-07-01", toDate: "2026-07-05", maxParticipants: 30,
    }));
    await settle();
    expect(insertTrainingMock).toHaveBeenCalledOnce();
    const row = insertTrainingMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("planned");
    expect(row.title).toBe("Leadership 101");
    await q.stop();
  });
});

describe("nominationCreate command", () => {
  it("inserts nomination with status 'nominated'", async () => {
    const q = new MemoryQueue(); registerTrainingConsumers(q); await q.start();
    await q.publish(COMMANDS.nominationCreate, makeMsg(COMMANDS.nominationCreate, {
      id: randomUUID(), tenantId: TENANT, trainingId: randomUUID(), employeeId: randomUUID(),
    }));
    await settle();
    expect(insertNominationMock).toHaveBeenCalledOnce();
    const row = insertNominationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("nominated");
    await q.stop();
  });
});
