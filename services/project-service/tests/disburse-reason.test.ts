/**
 * Fund-release disburse: the audit `reason` the web dialog collects must pass
 * the route validator, reach the command payload, and land on the audit event.
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
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("disburse reason", () => {
  it("validator keeps reason (not stripped) and rejects blank/oversized", () => {
    expect(disburseBody.parse({ pfmsRef: "PFMS-1", reason: "UC verified" })).toEqual({ pfmsRef: "PFMS-1", reason: "UC verified" });
    expect(disburseBody.safeParse({ reason: "   " }).success).toBe(false);
    expect(disburseBody.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });

  it("command payload carries reason", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "c", roles: [] };
    const body = disburseBody.parse({ pfmsRef: "PFMS-1", reason: "UC verified" });
    await disburseFundRelease(ctx as never, randomUUID(), randomUUID(), body);
    const msg = publish.mock.calls[0]![1] as { payload: Record<string, unknown> };
    expect(msg.payload.reason).toBe("UC verified");
    expect(msg.payload.pfmsRef).toBe("PFMS-1");
  });

  it("consumer records reason on the audit event", async () => {
    const rId = randomUUID(); const schemeId = randomUUID();
    repoMock.findFundReleaseByIdTx.mockResolvedValue({ id: rId, schemeId, status: "approved", amountMinor: 100n, version: 1, pfmsRef: null });
    const q = new MemoryQueue(); registerSchemeConsumers(q); await q.start();
    await q.publish(COMMANDS.fundReleaseDisburse, {
      messageId: randomUUID(), type: COMMANDS.fundReleaseDisburse, tenantId: TENANT, actorId: ACTOR,
      correlationId: "c", schemaVersion: "1.0",
      payload: { rId, tenantId: TENANT, schemeId, pfmsRef: "PFMS-1", reason: "UC verified" },
    });
    await settle();
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit?.payload.action).toBe("disburse");
    expect(audit?.payload.reason).toBe("UC verified");
    await q.stop();
  });
});
