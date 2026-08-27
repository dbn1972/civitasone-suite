/**
 * Regression test for two bugs in permits/consumer.ts:
 *
 * 1. renewPermit inserted an "approved" renewal record carrying the new
 *    expiry date but never wrote that date back onto the permit's own
 *    `validUntil` column — GET /v1/advertisement/permits/:id and the public
 *    /verify endpoint kept showing the OLD validUntil after a genuine
 *    renewal. It also proceeded even if the permit no longer existed
 *    (silently used `permit?.validUntil ?? null`).
 * 2. No consumer invalidated the permit's read-through cache
 *    (cache.getOrLoad, 60s TTL) on renew/suspend/cancel (CLAUDE.md §6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  findByIdMock, updateValidUntilMock, insertRenewalMock, updateStatusMock,
  invalidateMock, makeKeyMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    findByIdMock: vi.fn() as any,
    updateValidUntilMock: vi.fn(async () => true) as any,
    insertRenewalMock: vi.fn(async () => undefined) as any,
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
  insertPermit: vi.fn(async () => undefined),
  findById: (...args: any[]) => findByIdMock(...args),
  updateValidUntil: (...args: any[]) => updateValidUntilMock(...args),
  insertRenewal: (...args: any[]) => insertRenewalMock(...args),
  updateStatus: (...args: any[]) => updateStatusMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));
vi.mock("./domain.js", () => ({
  generatePermitNumber: vi.fn(() => "ADVP-1"),
  generateVerificationCode: vi.fn(() => "VERIFY-1"),
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
  findByIdMock.mockResolvedValue({ validUntil: "2026-01-01" });
  updateValidUntilMock.mockResolvedValue(true);
  updateStatusMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("renewPermit command", () => {
  const payload = { id: "renewal-1", permitId: PERMIT_ID, renewalType: "renewal", newValidUntil: "2027-01-01", feeMinor: "50000" };

  it("extends the permit's validUntil, records the renewal, and invalidates the cache", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.renewPermit, makeMsg(COMMANDS.renewPermit, payload));
    await settle();
    expect(updateValidUntilMock).toHaveBeenCalledWith(expect.anything(), PERMIT_ID, TENANT, "2027-01-01", ACTOR);
    expect(insertRenewalMock).toHaveBeenCalledOnce();
    const insertedRow = insertRenewalMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(insertedRow.newValidUntil).toBe("2027-01-01");
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.permitRenewed)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:permit:40000000-dddd-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT record a renewal, publish an event, or invalidate the cache when the permit no longer matches (fake-success guard)", async () => {
    updateValidUntilMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.renewPermit, makeMsg(COMMANDS.renewPermit, payload));
    await settle();
    expect(insertRenewalMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe.each([
  [COMMANDS.suspendPermit, { id: PERMIT_ID, reason: "Structural hazard" }],
  [COMMANDS.cancelPermit, { id: PERMIT_ID, reason: "Applicant request" }],
])("%s command", (command, payload) => {
  it("invalidates the permit's read-through cache entry when the update matches a row", async () => {
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:permit:40000000-dddd-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT invalidate the cache when the update matches no row", async () => {
    updateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
