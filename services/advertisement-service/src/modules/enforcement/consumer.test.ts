/**
 * Regression test: GET /v1/advertisement/violations/:id serves through
 * cache.getOrLoad (60s TTL); none of the four status-changing consumers
 * invalidated that key on write (CLAUDE.md §6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, findByIdMock, updateViolationMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    findByIdMock: vi.fn(async () => ({ violationType: "unauthorized_hoarding" })) as any,
    updateViolationMock: vi.fn(async () => true) as any,
    invalidateMock: vi.fn(async () => undefined) as any,
    makeKeyMock: vi.fn((...parts: string[]) => parts.join(":")) as any,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  insertViolation: vi.fn(async () => undefined),
  findById: (...args: any[]) => findByIdMock(...args),
  updateViolation: (...args: any[]) => updateViolationMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));
vi.mock("./domain.js", () => ({
  calculatePenaltyMinor: vi.fn(() => 500000n),
  generateViolationNumber: vi.fn(() => "ADVV-1"),
}));

import { registerEnforcementConsumers } from "./consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const VIOLATION_ID = "60000000-ffff-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerEnforcementConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  updateViolationMock.mockResolvedValue(true);
  findByIdMock.mockResolvedValue({ violationType: "unauthorized_hoarding" });
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe.each([
  [COMMANDS.issueNotice, { violationId: VIOLATION_ID, noticeDetails: {} }],
  [COMMANDS.imposePenalty, { violationId: VIOLATION_ID, penaltyMinor: "500000" }],
  [COMMANDS.orderRemoval, { violationId: VIOLATION_ID, removalDeadline: "2026-12-31" }],
  [COMMANDS.recordRemoval, { violationId: VIOLATION_ID, removalNotes: "Hoarding taken down" }],
])("%s command", (command, payload) => {
  it("invalidates the violation's read-through cache entry when the update matches a row", async () => {
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:violation:60000000-ffff-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT invalidate the cache when the update matches no row", async () => {
    updateViolationMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
