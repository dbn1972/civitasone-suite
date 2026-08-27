/**
 * Regression test: initiateScrutiny discarded appRepo.updateStatus's boolean
 * return, so a scrutiny record + scrutinyInitiated event + audit record
 * could be created for an application that was never actually moved to
 * "under_review" (fake-success). decideApplication was already correctly
 * guarded but never invalidated the application's read-through cache.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertScrutinyMock, completeScrutinyMock, updateStatusMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    insertScrutinyMock: vi.fn(async () => undefined) as any,
    completeScrutinyMock: vi.fn(async () => true) as any,
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
  insertScrutiny: (...args: any[]) => insertScrutinyMock(...args),
  completeScrutiny: (...args: any[]) => completeScrutinyMock(...args),
}));
vi.mock("../applications/repo.js", () => ({
  updateStatus: (...args: any[]) => updateStatusMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));

import { registerApprovalConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const APP_ID = "30000000-cccc-4000-8000-000000000001";
const SCRUTINY_ID = "50000000-eeee-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerApprovalConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  updateStatusMock.mockResolvedValue(true);
  completeScrutinyMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("initiateScrutiny command", () => {
  it("inserts scrutiny, publishes the event, and invalidates the application cache when the application update matches", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, { id: SCRUTINY_ID, applicationId: APP_ID, scrutinyType: "structural", officerId: ACTOR }));
    await settle();
    expect(insertScrutinyMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.scrutinyInitiated)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:application:30000000-cccc-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT insert a scrutiny record, publish an event, or invalidate the cache when the application update matches no row (fake-success guard)", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, { id: SCRUTINY_ID, applicationId: APP_ID, scrutinyType: "structural", officerId: ACTOR }));
    await settle();
    expect(insertScrutinyMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("decideApplication command", () => {
  it("invalidates the application cache when the update matches", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId: APP_ID, decision: "approved" }));
    await settle();
    expect(invalidateMock).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("does NOT invalidate the cache when the update matches no row", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId: APP_ID, decision: "rejected" }));
    await settle();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
