/**
 * Regression test for lifecycle/consumer.ts's decideRenewal: it called
 * repo.updateRenewalDecision and permitRepo.updateValidUntil (both
 * Promise<boolean>, false when zero rows matched) without checking either
 * result — so a stale/mismatched command still published renewalDecided and
 * wrote an audit record, and an approved renewal never invalidated the
 * permit's read-through cache even when validUntil genuinely changed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  findRenewalByIdMock, updateRenewalDecisionMock, updateValidUntilMock,
  invalidateMock, makeKeyMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    findRenewalByIdMock: vi.fn() as any,
    updateRenewalDecisionMock: vi.fn(async () => true) as any,
    updateValidUntilMock: vi.fn(async () => true) as any,
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
  insertRenewal: vi.fn(async () => undefined),
  insertCertificate: vi.fn(async () => undefined),
  findRenewalById: (...args: any[]) => findRenewalByIdMock(...args),
  updateRenewalDecision: (...args: any[]) => updateRenewalDecisionMock(...args),
}));
vi.mock("../permits/repo.js", () => ({
  findById: vi.fn(async () => null),
  updateValidUntil: (...args: any[]) => updateValidUntilMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));
vi.mock("./domain.js", () => ({
  calculateRenewalFeeMinor: vi.fn(() => 50000n),
  calculateNewValidUntil: vi.fn(() => new Date("2027-01-01T00:00:00Z")),
  generateCertificateVerificationCode: vi.fn(() => "VERIFY-1"),
}));

import { registerLifecycleConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const RENEWAL_ID = "60000000-ffff-4000-8000-000000000001";
const PERMIT_ID = "40000000-dddd-4000-8000-000000000001";

const RENEWAL_ROW = {
  id: RENEWAL_ID, tenantId: TENANT, permitId: PERMIT_ID, renewalType: "renewal",
  previousValidUntil: new Date("2026-01-01T00:00:00Z"),
};

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerLifecycleConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  findRenewalByIdMock.mockResolvedValue({ ...RENEWAL_ROW });
  updateRenewalDecisionMock.mockResolvedValue(true);
  updateValidUntilMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("decideRenewal command — approved", () => {
  it("extends the permit and invalidates the permit's read-through cache", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.decideRenewal, makeMsg(COMMANDS.decideRenewal, { id: RENEWAL_ID, decision: "approved" }));
    await settle();
    expect(updateValidUntilMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.renewalDecided)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledOnce();
    expect(makeKeyMock).toHaveBeenCalledWith(TENANT, "permit", PERMIT_ID);
    await q.stop();
  });

  it("does NOT publish renewalDecided when updateRenewalDecision matches no row (fake-success guard)", async () => {
    updateRenewalDecisionMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.decideRenewal, makeMsg(COMMANDS.decideRenewal, { id: RENEWAL_ID, decision: "approved" }));
    await settle();
    expect(updateValidUntilMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("does NOT invalidate the permit cache when the permit's own validUntil update matches no row", async () => {
    updateValidUntilMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.decideRenewal, makeMsg(COMMANDS.decideRenewal, { id: RENEWAL_ID, decision: "approved" }));
    await settle();
    // The renewal decision itself still genuinely happened, so the event IS published —
    // but nothing in the permit's cache actually changed, so it must not be invalidated.
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.renewalDecided)).toBeDefined();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("decideRenewal command — rejected", () => {
  it("does not attempt to extend the permit, but still publishes renewalDecided", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.decideRenewal, makeMsg(COMMANDS.decideRenewal, { id: RENEWAL_ID, decision: "rejected", reason: "Incomplete documents" }));
    await settle();
    expect(updateValidUntilMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.renewalDecided)).toBeDefined();
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
