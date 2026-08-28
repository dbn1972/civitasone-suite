/**
 * masters/consumer.ts — COMMANDS.openingBalancesEnter mocked consumer tests.
 *
 * Proves the non-bypassable half of the opening-balance integrity fix: even
 * if a caller publishes this command directly (skipping fy-routes.ts's own
 * synchronous check -- see masters-opening-balance-route.test.ts for that
 * half), an unbalanced entry set is rejected before a single row is
 * inserted, and the whole transaction (including the idempotency marker)
 * rolls back so a redelivery is rejected identically every time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, insertValuesMock, onConflictDoNothingMock, markProcessedMock } = vi.hoisted(() => {
  const _onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
  const _insertValuesMock = vi.fn().mockReturnValue({ onConflictDoNothing: _onConflictDoNothingMock });
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: _insertValuesMock }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    insertValuesMock: _insertValuesMock,
    onConflictDoNothingMock: _onConflictDoNothingMock,
    markProcessedMock: vi.fn(async () => true),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: (...a: any[]) => markProcessedMock(...a),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined) },
}));

import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-0000000000b1";
const ACTOR = "20000000-bbbb-4000-8000-0000000000b1";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.openingBalancesEnter, tenantId: TENANT,
    actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 150));

beforeEach(() => {
  vi.clearAllMocks();
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  markProcessedMock.mockResolvedValue(true);
  onConflictDoNothingMock.mockResolvedValue(undefined);
  insertValuesMock.mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
});

describe("COMMANDS.openingBalancesEnter consumer — integrity enforcement", () => {
  it("rejects an unbalanced entry set: no row is inserted and the message dead-letters", async () => {
    // maxAttempts:1 -- a DomainError is a permanent validation failure, never
    // transient, so there is no point retrying it; keeps the test fast too.
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();

    await q.publish(COMMANDS.openingBalancesEnter, makeMsg({
      id: randomUUID(), tenantId: TENANT, fyCode: "2026-27",
      entries: [
        { id: randomUUID(), accountCode: "1100", debitMinor: 100000, creditMinor: 0, narration: null },
        { id: randomUUID(), accountCode: "3100", debitMinor: 0, creditMinor: 90000, narration: null },
      ],
    }));
    await settle();

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]!.error).toContain("OPENING_BALANCE_UNBALANCED");
    await q.stop();
  });

  it("a redelivery of the same unbalanced message is rejected identically (transaction rollback undoes markProcessed too)", async () => {
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();
    const msg = makeMsg({
      id: randomUUID(), tenantId: TENANT, fyCode: "2026-27",
      entries: [
        { id: randomUUID(), accountCode: "1100", debitMinor: 500, creditMinor: 0, narration: null },
        { id: randomUUID(), accountCode: "3100", debitMinor: 0, creditMinor: 400, narration: null },
      ],
    });
    await q.publish(COMMANDS.openingBalancesEnter, msg);
    await settle();
    await q.publish(COMMANDS.openingBalancesEnter, msg);
    await settle();

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(q.dlq.length).toBe(2);
    await q.stop();
  });

  it("inserts every entry when the set is balanced (regression: the fix must not block legitimate data)", async () => {
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.start();

    await q.publish(COMMANDS.openingBalancesEnter, makeMsg({
      id: randomUUID(), tenantId: TENANT, fyCode: "2026-27",
      entries: [
        { id: randomUUID(), accountCode: "1100", debitMinor: 100000, creditMinor: 0, narration: "opening cash" },
        { id: randomUUID(), accountCode: "3100", debitMinor: 0, creditMinor: 100000, narration: "opening capital" },
      ],
    }));
    await settle();

    expect(insertValuesMock).toHaveBeenCalledTimes(2);
    expect(q.dlq.length).toBe(0);
    await q.stop();
  });
});
