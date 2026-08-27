/**
 * Regression test for two bugs found in building-service's permits consumer:
 *
 * 1. Fake-success / false audit trail: suspendPermit/cancelPermit/restorePermit
 *    called repo.updatePermitStatus (which returns `Promise<boolean>`, false
 *    when zero rows matched — e.g. wrong tenant, already-deleted, stale
 *    duplicate command) but discarded the return value. The handler then
 *    unconditionally published the permitSuspended/Cancelled/Restored EVENT
 *    and wrote an audit-log entry claiming the action happened, even when the
 *    underlying row update affected nothing. This is the same class of bug as
 *    the sibling `applications` module already guards against.
 *
 * 2. Missing read-through cache invalidation: GET /v1/building/permits/:id
 *    serves through `cache.getOrLoad` (shared/infra.ts, TTL 60s); no consumer
 *    invalidated that entry after a real status change. Per @civitasone/cache's
 *    own header comment (CLAUDE.md §6): "writes never touch the read path —
 *    the consumer invalidates here."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, updatePermitStatusMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  const _updatePermitStatusMock = vi.fn(async () => true);
  const _invalidateMock = vi.fn(async () => undefined);
  const _makeKeyMock = vi.fn((...parts: string[]) => parts.join(":"));
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    updatePermitStatusMock: _updatePermitStatusMock as any,
    invalidateMock: _invalidateMock as any,
    makeKeyMock: _makeKeyMock as any,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));

vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("./repo.js", () => ({
  insertPermit: vi.fn(async () => undefined),
  updatePermitStatus: (...args: any[]) => updatePermitStatusMock(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));

import { registerPermitConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const PERMIT_ID = "40000000-dddd-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerPermitConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  updatePermitStatusMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

describe("suspendPermit command", () => {
  it("publishes permitSuspended and invalidates the cache when the update actually matched a row", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.suspendPermit, makeMsg(COMMANDS.suspendPermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Structural violation" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitSuspended)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "permit", PERMIT_ID);
    await q.stop();
  });

  it("does NOT publish permitSuspended or invalidate the cache when the update matched no row (fake-success guard)", async () => {
    updatePermitStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.suspendPermit, makeMsg(COMMANDS.suspendPermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Structural violation" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitSuspended)).toBeUndefined();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("cancelPermit command", () => {
  it("publishes permitCancelled and invalidates the cache when the update actually matched a row", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.cancelPermit, makeMsg(COMMANDS.cancelPermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Applicant request" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitCancelled)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("does NOT publish permitCancelled when the update matched no row", async () => {
    updatePermitStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.cancelPermit, makeMsg(COMMANDS.cancelPermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Applicant request" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitCancelled)).toBeUndefined();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("restorePermit command", () => {
  it("publishes permitRestored and invalidates the cache when the update actually matched a row", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.restorePermit, makeMsg(COMMANDS.restorePermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Compliance restored" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitRestored)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledOnce();
    await q.stop();
  });

  it("does NOT publish permitRestored when the update matched no row", async () => {
    updatePermitStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.restorePermit, makeMsg(COMMANDS.restorePermit, { permitId: PERMIT_ID, tenantId: TENANT, reason: "Compliance restored" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitRestored)).toBeUndefined();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
