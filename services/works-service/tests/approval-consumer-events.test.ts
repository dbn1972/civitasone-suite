/**
 * Approval consumer — AA/TS create and finalize emit domain events + audit records.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { administrativeApprovals, technicalSanctions } from "../src/modules/approval/schema.js";
import { TENANT_A, ACTOR_A, queueMessage } from "./fixtures/works-fixtures.js";

const mockInserted: unknown[] = [];
const mockUpdated: unknown[] = [];
const mockEnqueued: Array<{ topic: string; payload?: unknown }> = [];
let mockMarkResult = true;

const mockTx: any = {
  insert: (t: unknown) => { mockInserted.push(t); return { values: () => Promise.resolve() }; },
  update: (t: unknown) => { mockUpdated.push(t); return { set: () => ({ where: () => Promise.resolve() }) }; },
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload?: unknown }) => {
    mockEnqueued.push(ev);
    return Promise.resolve();
  }),
  outboxMessages: {}, processed: {}, outboxSchema: {},
}));

const AUDIT = "audit.event.record";

beforeEach(() => {
  mockInserted.length = 0;
  mockUpdated.length = 0;
  mockEnqueued.length = 0;
  mockMarkResult = true;
});

async function approvalHandlers(): Promise<Record<string, Function>> {
  const { registerApprovalConsumers } = await import("../src/modules/approval/consumer.js");
  const h: Record<string, Function> = {};
  registerApprovalConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

function emitted(topic: string): boolean {
  return mockEnqueued.some((e) => e.topic === topic);
}

describe("Approval consumer events + audit", () => {
  it("aaCreate inserts into administrativeApprovals + emits aaCreated + audit", async () => {
    const h = await approvalHandlers();
    await h[COMMANDS.aaCreate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-aa-1"),
      payload: {
        id: "aa-1", workId: "w-1", aaNumber: "AA/2026/001", aaDate: "2026-01-01",
        approvingAuthorityId: "auth-1", approvedAmountMinor: "5000000", approvalType: "original",
      },
    });
    expect(mockInserted[0]).toBe(administrativeApprovals);
    expect(emitted(EVENTS.aaCreated)).toBe(true);
    expect(emitted(AUDIT)).toBe(true);
    const audit = mockEnqueued.find((e) => e.topic === AUDIT);
    expect((audit?.payload as any)?.resourceType).toBe("aa");
    expect((audit?.payload as any)?.action).toBe("create");
  });

  it("aaFinalize updates status + emits aaFinalized + audit (immutable transition)", async () => {
    const h = await approvalHandlers();
    await h[COMMANDS.aaFinalize]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-aa-fin-1"),
      payload: { id: "aa-1" },
    });
    expect(mockUpdated).toHaveLength(1);
    expect(emitted(EVENTS.aaFinalized)).toBe(true);
    expect(emitted(AUDIT)).toBe(true);
    expect((mockEnqueued.find((e) => e.topic === AUDIT)?.payload as any)?.action).toBe("finalize");
  });

  it("tsCreate inserts into technicalSanctions + emits tsCreated + audit", async () => {
    const h = await approvalHandlers();
    await h[COMMANDS.tsCreate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-ts-1"),
      payload: {
        id: "ts-1", workId: "w-1", tsNumber: "TS/2026/001", tsDate: "2026-01-01",
        tsAuthorityId: "auth-1", tsAmountMinor: "5000000", sanctionType: "original",
      },
    });
    expect(mockInserted[0]).toBe(technicalSanctions);
    expect(emitted(EVENTS.tsCreated)).toBe(true);
    expect(emitted(AUDIT)).toBe(true);
  });

  it("aaCreate is idempotent — duplicate messageId skips insert", async () => {
    mockMarkResult = false;
    const h = await approvalHandlers();
    await h[COMMANDS.aaCreate]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-dup"),
      payload: {
        id: "aa-dup", workId: "w-1", aaNumber: "AA/2026/002", aaDate: "2026-01-01",
        approvingAuthorityId: "auth-1", approvedAmountMinor: "100", approvalType: "original",
      },
    });
    expect(mockInserted).toHaveLength(0);
    expect(emitted(EVENTS.aaCreated)).toBe(false);
  });
});
