/**
 * GAP2-PROJECTS-FUND-RELEASES-07: separation of duties on a money-out fund
 * release disbursement. The actor who CREATED the release may not disburse it.
 *
 *  - command: creator (actor A) disbursing release created-by A → 403 SOD_VIOLATION,
 *    nothing published.
 *  - command: a DIFFERENT actor (B) disbursing → publishes the disburse command.
 *  - consumer (defence in depth): a disburse message whose actor equals the
 *    release creator does NOT flip status to 'disbursed', and enqueues a
 *    fund_release.sod_violation event + an audit rejection event.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, markProcessedMock, publish, repoMock } = vi.hoisted(() => {
  const _mockTx = {};
  return {
    mockTx: _mockTx,
    dbTransactionFn: vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); }) as any,
    enqueuedMessages: [] as Array<{ topic: string; payload: any }>,
    markProcessedMock: vi.fn(async () => true),
    publish: vi.fn(async () => undefined),
    repoMock: {
      findFundReleaseById: vi.fn(),
      findFundReleaseByIdTx: vi.fn(),
      updateFundReleaseTx: vi.fn(async () => undefined),
      incrementSchemeReleasedTx: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("@civitasone/db", () => ({
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
  withTenantConsumer: (handler: (msg: unknown) => Promise<void>) => handler,
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: (...a: any[]) => (markProcessedMock as any)(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => (publish as any)(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../src/modules/scheme/repo.js", () => repoMock);

import { disburseBody } from "../src/modules/scheme/validators.js";
import { disburseFundRelease } from "../src/modules/scheme/commands.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { HttpError } from "../src/shared/context.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR_A = "20000000-bbbb-4000-8000-00000000000a"; // creator
const ACTOR_B = "20000000-bbbb-4000-8000-00000000000b"; // checker
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("GAP2-PROJECTS-FUND-RELEASES-07 — fund release disburse SoD", () => {
  it("command: creator disbursing own release → 403 SOD_VIOLATION, nothing published", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR_A, correlationId: "c", roles: [] };
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseById.mockResolvedValue({ id: rId, createdBy: ACTOR_A, status: "approved" });
    await expect(disburseFundRelease(ctx as never, schemeId, rId, disburseBody.parse({})))
      .rejects.toMatchObject({ status: 403, code: "SOD_VIOLATION" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("command: a different actor (checker) disbursing → publishes the command", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR_B, correlationId: "c", roles: [] };
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseById.mockResolvedValue({ id: rId, createdBy: ACTOR_A, status: "approved" });
    const res = await disburseFundRelease(ctx as never, schemeId, rId, disburseBody.parse({}));
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalledTimes(1);
    const msg = publish.mock.calls[0]![1] as { payload: Record<string, unknown> };
    expect(msg.payload.rId).toBe(rId);
  });

  it("command: unknown release → 404 NOT_FOUND", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR_B, correlationId: "c", roles: [] };
    repoMock.findFundReleaseById.mockResolvedValue(null);
    await expect(disburseFundRelease(ctx as never, randomUUID(), randomUUID(), disburseBody.parse({})))
      .rejects.toBeInstanceOf(HttpError);
  });

  it("consumer: actor == creator does NOT disburse; emits sod_violation + audit rejection", async () => {
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseByIdTx.mockResolvedValue({ id: rId, schemeId, createdBy: ACTOR_A, status: "approved", amountMinor: 100n, version: 1, pfmsRef: null });
    const q = new MemoryQueue(); registerSchemeConsumers(q); await q.start();
    await q.publish(COMMANDS.fundReleaseDisburse, {
      messageId: randomUUID(), type: COMMANDS.fundReleaseDisburse, tenantId: TENANT, actorId: ACTOR_A,
      correlationId: "c", schemaVersion: "1.0",
      payload: { rId, tenantId: TENANT, schemeId },
    });
    await settle();
    // Status NOT flipped — updateFundReleaseTx never called.
    expect(repoMock.updateFundReleaseTx).not.toHaveBeenCalled();
    const sod = enqueuedMessages.find((m) => m.topic === EVENTS.fundReleaseSodViolation);
    expect(sod).toBeTruthy();
    expect(sod?.payload.releaseId).toBe(rId);
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record" && m.payload.action === "disburse_rejected");
    expect(audit).toBeTruthy();
    await q.stop();
  });

  it("consumer: a different actor DOES disburse (status flipped, disbursed event)", async () => {
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseByIdTx.mockResolvedValue({ id: rId, schemeId, createdBy: ACTOR_A, status: "approved", amountMinor: 100n, version: 1, pfmsRef: null });
    const q = new MemoryQueue(); registerSchemeConsumers(q); await q.start();
    await q.publish(COMMANDS.fundReleaseDisburse, {
      messageId: randomUUID(), type: COMMANDS.fundReleaseDisburse, tenantId: TENANT, actorId: ACTOR_B,
      correlationId: "c", schemaVersion: "1.0",
      payload: { rId, tenantId: TENANT, schemeId },
    });
    await settle();
    expect(repoMock.updateFundReleaseTx).toHaveBeenCalledTimes(1);
    const disbursed = enqueuedMessages.find((m) => m.topic === EVENTS.fundReleaseDisbursed);
    expect(disbursed).toBeTruthy();
    await q.stop();
  });

  it("chained: create(A) -> approved -> disburse(B) twice → one messageId, single state change", async () => {
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseById.mockResolvedValue({ id: rId, createdBy: ACTOR_A, status: "approved" });
    repoMock.findFundReleaseByIdTx.mockResolvedValue({ id: rId, schemeId, createdBy: ACTOR_A, status: "approved", amountMinor: 100n, version: 1, pfmsRef: null });
    // The real queue dedupe is markProcessed(messageId): true first time, false after.
    const seen = new Set<string>();
    markProcessedMock.mockImplementation((async (_tx: unknown, id: string) => { if (seen.has(id)) return false; seen.add(id); return true; }) as never);
    const q = new MemoryQueue(); registerSchemeConsumers(q); await q.start();
    publish.mockImplementation((async (topic: string, msg: never) => { await q.publish(topic, msg); }) as never);
    const ctx = { tenantId: TENANT, actorId: ACTOR_B, correlationId: "c", roles: [] };
    await disburseFundRelease(ctx as never, schemeId, rId, disburseBody.parse({}));
    await disburseFundRelease(ctx as never, schemeId, rId, disburseBody.parse({}));
    await settle();
    expect(publish).toHaveBeenCalledTimes(2);
    const ids = publish.mock.calls.map((c) => (c[1] as { messageId: string }).messageId);
    expect(ids[0]).toBe(ids[1]);
    expect(repoMock.updateFundReleaseTx).toHaveBeenCalledTimes(1);
    expect(enqueuedMessages.filter((m) => m.topic === EVENTS.fundReleaseDisbursed)).toHaveLength(1);
    await q.stop();
  });

  it("an explicit x-idempotency-key drives the messageId", async () => {
    const rId = randomUUID();
    repoMock.findFundReleaseById.mockResolvedValue({ id: rId, createdBy: ACTOR_A, status: "approved" });
    const a = { tenantId: TENANT, actorId: ACTOR_B, correlationId: "c", roles: [], idempotencyKey: "k1" };
    const b = { ...a, idempotencyKey: "k2" };
    await disburseFundRelease(a as never, randomUUID(), rId, disburseBody.parse({}));
    await disburseFundRelease(b as never, randomUUID(), rId, disburseBody.parse({}));
    const ids = publish.mock.calls.map((c) => (c[1] as { messageId: string }).messageId);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
