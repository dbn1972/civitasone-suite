/**
 * Regression test: committee/consumer.ts discarded the boolean return of
 * every cross-module write into registrations/repo.js (updateStatus,
 * allocateZone) and its own repo.completeReview — so a stale/mismatched
 * command still inserted records, published events, and wrote audit
 * entries for registrations/reviews that were never actually updated
 * (fake-success), and never invalidated the registration's read-through
 * cache on a real write (CLAUDE.md §6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  insertReviewMock, completeReviewMock, regUpdateStatusMock, allocateZoneMock,
  invalidateMock, makeKeyMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: unknown }>,
    insertReviewMock: vi.fn(async () => undefined) as any,
    completeReviewMock: vi.fn(async () => true) as any,
    regUpdateStatusMock: vi.fn(async () => true) as any,
    allocateZoneMock: vi.fn(async () => true) as any,
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
  insertReview: (...args: any[]) => insertReviewMock(...args),
  completeReview: (...args: any[]) => completeReviewMock(...args),
}));
vi.mock("../registrations/repo.js", () => ({
  updateStatus: (...args: any[]) => regUpdateStatusMock(...args),
  allocateZone: (...args: any[]) => allocateZoneMock(...args),
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => invalidateMock(...args), makeKey: (...args: any[]) => makeKeyMock(...args) },
}));

import { registerCommitteeConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const REG_ID = "30000000-cccc-4000-8000-000000000001";
const REVIEW_ID = "50000000-eeee-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerCommitteeConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  regUpdateStatusMock.mockResolvedValue(true);
  allocateZoneMock.mockResolvedValue(true);
  completeReviewMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("assignCommitteeReview command", () => {
  it("inserts the review, publishes the event, and invalidates the registration cache when the registration update matches", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.assignCommitteeReview, makeMsg(COMMANDS.assignCommitteeReview, { id: REVIEW_ID, registrationId: REG_ID, committeeType: "hawking" }));
    await settle();
    expect(insertReviewMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.committeeReviewAssigned)).toBeDefined();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:registration:30000000-cccc-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT insert a review, publish an event, or invalidate the cache when the registration update matches no row (fake-success guard)", async () => {
    regUpdateStatusMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.assignCommitteeReview, makeMsg(COMMANDS.assignCommitteeReview, { id: REVIEW_ID, registrationId: REG_ID, committeeType: "hawking" }));
    await settle();
    expect(insertReviewMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("completeCommitteeReview command", () => {
  it("does NOT publish an event when the review update matches no row (fake-success guard)", async () => {
    completeReviewMock.mockResolvedValueOnce(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.completeCommitteeReview, makeMsg(COMMANDS.completeCommitteeReview, { id: REVIEW_ID, findings: {}, recommendation: "approve" }));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    await q.stop();
  });
});

describe.each([
  [COMMANDS.allocateZone, { registrationId: REG_ID, zone: "Z1", spot: "S12" }],
  [COMMANDS.approveRegistration, { registrationId: REG_ID }],
  [COMMANDS.rejectRegistration, { registrationId: REG_ID, reason: "Documents incomplete" }],
])("%s command", (command, payload) => {
  it("invalidates the registration's read-through cache entry when the update matches a row", async () => {
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(invalidateMock).toHaveBeenCalledWith("10000000-aaaa-4000-8000-000000000001:registration:30000000-cccc-4000-8000-000000000001");
    await q.stop();
  });

  it("does NOT publish an event or invalidate the cache when the update matches no row", async () => {
    // Set the persistent default (not mockResolvedValueOnce) on both mocks:
    // each command in this table only ever calls ONE of the two, and an
    // unconsumed "Once" queued on the other would otherwise leak into a
    // later test's default resolution (beforeEach only re-arms the base
    // mockResolvedValue(true), it doesn't drain stale queued "Once" values).
    regUpdateStatusMock.mockResolvedValue(false);
    allocateZoneMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(command, makeMsg(command, payload));
    await settle();
    expect(enqueuedMessages.length).toBe(0);
    expect(invalidateMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
