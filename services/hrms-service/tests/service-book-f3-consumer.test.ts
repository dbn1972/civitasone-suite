/**
 * Service-book F3 consumer unit tests — mock-based.
 *
 * SEC-CRIT-002: add/edit/attest must each emit an audit.event.record entry.
 * This consumer previously emitted none at all — a regression versus the
 * legacy service-book/consumer.ts it superseded, which did call
 * enqueue(...AUDIT) for add/verify.
 *
 * SEC-CRIT-003 (consumer-side error handling only): an edit whose guarded
 * UPDATE matches no row (i.e. the entry is already attested) must fail
 * loudly, not silently no-op while still reporting success. The WHERE-clause
 * guard itself is proven against a real Postgres in
 * service-book-attested-immutability.test.ts; this file only proves this
 * consumer's handling of a 0-row UPDATE result and its interaction with the
 * audit call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueuedMessages, returningMock, insertMock } = vi.hoisted(() => {
  const _enqueuedMessages: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  const _returningMock = vi.fn(async () => [{ id: "row" }]);
  const _insertMock = vi.fn(async () => undefined);
  const _mockTx = {
    // Chainable stub for tx.update(table).set(values).where(cond).returning().
    // We don't model WHERE evaluation here (that needs a real DB — see the
    // sibling real-DB test file) — returningMock's resolved value is what
    // each test configures to simulate "guard matched" vs "guard blocked it".
    update: () => ({ set: () => ({ where: () => ({ returning: _returningMock }) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb(_mockTx));
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn,
    enqueuedMessages: _enqueuedMessages,
    returningMock: _returningMock,
    insertMock: _insertMock,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: Record<string, unknown> }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/service-book/repo.js", () => ({
  insertServiceBookEntry: (...a: unknown[]) => insertMock(...a),
}));

import { registerF3_service_book_Consumers } from "../src/modules/service-book/f3-consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(op: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { op, id, tenantId: TENANT, body: {}, params: {}, ...extra },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  returningMock.mockReset();
  returningMock.mockResolvedValue([{ id: "row" }]);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb(mockTx));
});

async function run(q: MemoryQueue, op: string, id: string, extra: Record<string, unknown> = {}) {
  await q.publish(COMMANDS.f3RouteWrite, makeMsg(op, id, extra));
  await q.drain();
}

describe("service_book_routes__0 (add)", () => {
  it("inserts the entry and emits an audit.event.record", async () => {
    const q = new MemoryQueue();
    registerF3_service_book_Consumers(q);
    await q.start();
    const id = randomUUID();
    await run(q, "service_book_routes__0", id, {
      params: { id: randomUUID() },
      body: { entryType: "promotion", effectiveDate: "2026-01-01", description: "Promoted" },
    });
    expect(insertMock).toHaveBeenCalledOnce();
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({ action: "add_entry", resourceType: "service_book", resourceId: id, outcome: "success" });
    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });
});

describe("service_book_routes__1 (edit)", () => {
  it("updates and emits an audit.event.record when the guarded UPDATE matches a row", async () => {
    const q = new MemoryQueue();
    registerF3_service_book_Consumers(q);
    await q.start();
    const id = randomUUID();
    returningMock.mockResolvedValue([{ id }]);
    await run(q, "service_book_routes__1", id, { body: { description: "Updated" } });
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({ action: "edit", resourceType: "service_book", resourceId: id, outcome: "success" });
    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });

  it("does NOT emit audit and is dead-lettered (not a silent no-op) when the guarded UPDATE matches no row", async () => {
    const q = new MemoryQueue();
    registerF3_service_book_Consumers(q);
    await q.start();
    const id = randomUUID();
    returningMock.mockResolvedValue([]); // simulates: entry is already attested
    await run(q, "service_book_routes__1", id, { body: { description: "Updated" } });
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toMatch(/attested/i);
    await q.stop();
  });
});

describe("service_book_routes__2 (attest)", () => {
  it("attests and emits an audit.event.record", async () => {
    const q = new MemoryQueue();
    registerF3_service_book_Consumers(q);
    await q.start();
    const id = randomUUID();
    returningMock.mockResolvedValue([{ id }]);
    await run(q, "service_book_routes__2", id, { body: { remarks: "Verified" } });
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect(audit!.payload).toMatchObject({ action: "attest", resourceType: "service_book", resourceId: id, outcome: "success" });
    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });

  it("skips the audit call (no false success record) on a double-attest race, without dead-lettering", async () => {
    const q = new MemoryQueue();
    registerF3_service_book_Consumers(q);
    await q.start();
    const id = randomUUID();
    returningMock.mockResolvedValue([]); // simulates: already attested by a concurrent winner
    await run(q, "service_book_routes__2", id, { body: {} });
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });
});
