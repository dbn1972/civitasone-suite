/**
 * Regression test: GET /v1/vendor/licences/:id serves through
 * cache.getOrLoad (60s TTL); suspendLicence/cancelLicence discarded
 * repo.updateStatus's boolean AND never invalidated that key on write
 * (CLAUDE.md §6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, updateStatusMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    updateStatusMock: vi.fn(async () => true) as any,
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
  insertLicence: vi.fn(async () => undefined),
  updateStatus: (...args: any[]) => updateStatusMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));
vi.mock("./domain.js", () => ({
  generateLicenceNumber: vi.fn(() => "VL-1"),
  generateVerificationCode: vi.fn(() => "VERIFY-1"),
}));

import { registerLicenceConsumers } from "./consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const LICENCE_ID = "40000000-dddd-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerLicenceConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  updateStatusMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe.each([
  [COMMANDS.suspendLicence, { id: LICENCE_ID, reason: "Non-payment of fees" }],
  [COMMANDS.cancelLicence, { id: LICENCE_ID, reason: "Vendor closed business" }],
])("%s command", (command, payload) => {
  it("invalidates the licence's read-through cache entry when the update matches a row", async () => {
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:licence:40000000-dddd-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT publish an event or invalidate the cache when the update matches no row (fake-success guard)", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
