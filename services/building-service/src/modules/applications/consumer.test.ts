/**
 * Regression test for the building-service applications read-through cache.
 *
 * Bug: GET /v1/building/applications/:id serves through `cache.getOrLoad`
 * (shared/infra.ts, TTL 60s), but the submit/withdraw/fee-payment consumers
 * never invalidated that entry after a real write — a citizen could see
 * stale status (e.g. still "draft" after submitting, or feePaid:false after
 * paying) for up to 60s. Per @civitasone/cache's own header comment
 * (CLAUDE.md §6): "writes never touch the read path — the consumer
 * invalidates here." Other services (e.g. admin-service/modules/tenants)
 * already follow this; building-service's applications/permits modules did
 * not. This test locks in the fix: every status-changing consumer must call
 * cache.invalidate(cache.makeKey(tenantId, "application", id)).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, updateStatusMock, updateFeePaymentMock, invalidateMock, makeKeyMock } = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  const _updateStatusMock = vi.fn(async () => true);
  const _updateFeePaymentMock = vi.fn(async () => true);
  const _invalidateMock = vi.fn(async () => undefined);
  const _makeKeyMock = vi.fn((...parts: string[]) => parts.join(":"));
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    updateStatusMock: _updateStatusMock as any,
    updateFeePaymentMock: _updateFeePaymentMock as any,
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
  insertApplication: vi.fn(async () => undefined),
  updateStatus: (...args: any[]) => updateStatusMock(...args),
  updateFeePayment: (...args: any[]) => updateFeePaymentMock(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));

import { registerApplicationConsumers } from "./consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const APP_ID = "30000000-cccc-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerApplicationConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  updateStatusMock.mockResolvedValue(true);
  updateFeePaymentMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

describe("submitApplication command", () => {
  it("invalidates the application's read-through cache entry after a successful status update", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: APP_ID, tenantId: TENANT }));
    await settle();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "application", APP_ID);
    await q.stop();
  });

  it("does NOT invalidate, and does NOT publish applicationSubmitted, when the underlying update matched no row", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: APP_ID, tenantId: TENANT }));
    await settle();
    expect(invalidateMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    await q.stop();
  });
});

describe("withdrawApplication command", () => {
  it("invalidates the application's read-through cache entry", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.withdrawApplication, makeMsg(COMMANDS.withdrawApplication, { id: APP_ID, tenantId: TENANT }));
    await settle();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "application", APP_ID);
    await q.stop();
  });
});

describe("recordFeePayment command", () => {
  it("invalidates the application's read-through cache entry so feePaid is not served stale", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.recordFeePayment, makeMsg(COMMANDS.recordFeePayment, { id: APP_ID, tenantId: TENANT, transactionId: "TXN-1" }));
    await settle();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "application", APP_ID);
    await q.stop();
  });
});
