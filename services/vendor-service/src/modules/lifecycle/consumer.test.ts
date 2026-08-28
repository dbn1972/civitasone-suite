/**
 * Regression test: decideLifecycleRequest discarded repo.updateDecision's
 * boolean return, so a stale/mismatched decide command still published
 * lifecycleRequestDecided and wrote an audit record for a decision that was
 * never actually recorded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, updateDecisionMock } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    updateDecisionMock: vi.fn(async () => true) as any,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  insertRenewal: vi.fn(async () => undefined),
  updateDecision: (...args: any[]) => updateDecisionMock(...args),
}));
vi.mock("./domain.js", () => ({
  calculateRenewalFeeMinor: vi.fn(() => 50000n),
}));

import { registerLifecycleConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const REQUEST_ID = "60000000-ffff-4000-8000-000000000001";

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
  updateDecisionMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("decideLifecycleRequest command", () => {
  it("publishes lifecycleRequestDecided when the renewal request update matches a row", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.decideLifecycleRequest, makeMsg(COMMANDS.decideLifecycleRequest, { id: REQUEST_ID, decision: "approved", newValidUntil: "2027-01-01" }));
    await settle();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.lifecycleRequestDecided)).toBeDefined();
    await q.stop();
  });

  it("does NOT publish an event or write an audit record when the renewal request matches no row (fake-success guard)", async () => {
    updateDecisionMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.decideLifecycleRequest, makeMsg(COMMANDS.decideLifecycleRequest, { id: REQUEST_ID, decision: "approved", newValidUntil: "2027-01-01" }));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    await q.stop();
  });
});
