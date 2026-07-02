/**
 * Tenant onboard consumer mock test — seeds chart of accounts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, insertMock } = vi.hoisted(() => {
  const _insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) });
  const _mockTx = { insert: _insertMock };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return { mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any, enqueuedMessages: _enqueuedMessages, insertMock: _insertMock };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/hoa/schema.js", () => ({
  financeMajorHeads: { _: "financeMajorHeads" },
}));

import { registerTenantOnboardConsumers } from "../src/modules/tenant-onboard/consumer.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => { vi.clearAllMocks(); enqueuedMessages.length = 0; dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); }); });

describe("tenant.tenant.onboarded → seed chart of accounts", () => {
  it("inserts all standard major heads and emits audit event", async () => {
    const q = new MemoryQueue();
    registerTenantOnboardConsumers(q);
    await q.start();
    await q.publish("tenant.tenant.onboarded", {
      messageId: randomUUID(), type: "tenant.tenant.onboarded",
      tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, adminEmail: "admin@gov.in", adminName: "Admin", edition: "govt_dept" },
    });
    await settle();
    // Should have called insert for each standard major head (64+ heads)
    expect(insertMock).toHaveBeenCalled();
    expect(insertMock.mock.calls.length).toBeGreaterThan(50);
    // Audit event emitted
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect((audit!.payload as any).action).toBe("seed_chart_of_accounts");
    await q.stop();
  });
});
