/**
 * Re-review regression test (PR #821 REQUEST CHANGES, MEDIUM finding (b)):
 *
 * updateProperty used to call cache.invalidate() INSIDE db.transaction(),
 * before commit — a concurrent GET could repopulate the cache with the
 * pre-update row in the window between that invalidate() call and the actual
 * commit, leaving GET /properties/:id serving stale data until the next
 * write. The fix moves invalidate() to after the transaction, gated on
 * whether the update actually matched a row — matching
 * allotments/consumer.ts's (already-correct) cache.put() placement in this
 * same PR. This test asserts invalidate() is called only once the mocked
 * transaction callback has fully returned, and not at all when the update
 * matches no row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, updatePropertyMock, invalidateMock } = vi.hoisted(() => {
  const _mockTx = {};
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    updatePropertyMock: vi.fn() as any,
    invalidateMock: vi.fn(async () => undefined) as any,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../../shared/audit.js", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("../../shared/infra.js", () => ({ cache: { invalidate: (...a: unknown[]) => invalidateMock(...a) } }));
vi.mock("./repo.js", () => ({
  insertProperty: vi.fn(),
  updateProperty: (...a: unknown[]) => updatePropertyMock(...a),
}));

import { registerPropertyConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const PROPERTY_ID = "30000000-cccc-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.updateProperty, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerPropertyConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("updateProperty consumer — cache invalidation happens after commit", () => {
  it("invalidates the property's cache entry only once db.transaction has resolved, when the update matches a row", async () => {
    updatePropertyMock.mockResolvedValue(true);
    let transactionHadReturned = false;
    dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb(mockTx);
      transactionHadReturned = true;
    });
    invalidateMock.mockImplementation(async () => {
      // The whole point of the fix: by the time invalidate() runs, the
      // transaction callback must have already fully returned (i.e. the
      // write is committed, not merely queued inside an in-flight tx).
      expect(transactionHadReturned).toBe(true);
    });

    const q = await buildQueue();
    await q.publish(COMMANDS.updateProperty, makeMsg({ id: PROPERTY_ID, marketName: "Renamed Market" }));
    await settle();

    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledWith(`market:${TENANT}:property:${PROPERTY_ID}`);
    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]?.topic).toBe(EVENTS.propertyUpdated);
    await q.stop();
  });

  it("does NOT invalidate the cache when the update matches no row", async () => {
    updatePropertyMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.updateProperty, makeMsg({ id: PROPERTY_ID, marketName: "Renamed Market" }));
    await settle();

    expect(invalidateMock).not.toHaveBeenCalled();
    expect(enqueuedMessages).toHaveLength(0);
    await q.stop();
  });

  it("threads securityDepositMinor through to the repo update as a BigInt, alongside monthlyRentMinor", async () => {
    updatePropertyMock.mockResolvedValue(true);
    const q = await buildQueue();
    await q.publish(COMMANDS.updateProperty, makeMsg({ id: PROPERTY_ID, monthlyRentMinor: 600000, securityDepositMinor: 1200000 }));
    await settle();

    expect(updatePropertyMock).toHaveBeenCalledOnce();
    const [, , , data] = updatePropertyMock.mock.calls[0] as [unknown, unknown, unknown, Record<string, unknown>];
    expect(data.monthlyRentMinor).toBe(600000n);
    expect(data.securityDepositMinor).toBe(1200000n);
    await q.stop();
  });
});
