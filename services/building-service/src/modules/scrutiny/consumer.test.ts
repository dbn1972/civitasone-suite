/**
 * Regression test for scrutiny/consumer.ts: initiateScrutiny and
 * decideApplication both call appRepo.updateStatus (Promise<boolean>,
 * false when zero rows matched) without checking the result — so a
 * stale/mismatched command still inserted a scrutiny record, published a
 * success event, and wrote an audit record, and never invalidated the
 * application's read-through cache. Same bug class already fixed in
 * applications/consumer.ts and permits/consumer.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertScrutinyMock, completeScrutinyMock, updateStatusMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
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
vi.mock("./domain.js", () => ({
  validateDcrResults: vi.fn(() => ({ allPassed: true, failures: [] })),
}));

import { registerScrutinyConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const SCRUTINY_ID = "50000000-eeee-4000-8000-000000000001";
const APP_ID = "30000000-cccc-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerScrutinyConsumers(q);
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
  it("inserts the scrutiny record, publishes the event, and invalidates the application cache when the application update matches", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, { id: SCRUTINY_ID, applicationId: APP_ID, discipline: "structural", officerId: ACTOR }));
    await settle();
    expect(insertScrutinyMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.scrutinyInitiated)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "application", APP_ID);
    await q.stop();
  });

  it("does NOT insert a scrutiny record, publish an event, or invalidate the cache when the application update matches no row", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, { id: SCRUTINY_ID, applicationId: APP_ID, discipline: "structural", officerId: ACTOR }));
    await settle();
    expect(insertScrutinyMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("decideApplication command", () => {
  it("publishes applicationDecided and invalidates the cache when the application update matches", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId: APP_ID, decision: "approved", reason: "All checks passed" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.applicationDecided)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:application:30000000-cccc-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT publish applicationDecided when the application update matches no row (fake-success guard)", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId: APP_ID, decision: "rejected", reason: "Non-compliant" }));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("completeScrutiny command", () => {
  it("does NOT publish scrutinyCompleted when the underlying update matches no row", async () => {
    completeScrutinyMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.completeScrutiny, makeMsg(COMMANDS.completeScrutiny, { id: SCRUTINY_ID, findings: {} }));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    await q.stop();
  });
});
