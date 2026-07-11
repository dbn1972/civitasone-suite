/**
 * order consumer tests — record insert/emit and exactly-once redelivery.
 * db/outbox/repo/schema/topics are mocked; the REAL NonRetryableError is used.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, id: string) => {
    if (processedIds.has(id)) return false;
    processedIds.add(id);
    return true;
  }),
  enqueue: vi.fn(async () => {}),
}));

vi.mock("../src/modules/order/schema.js", () => ({ orders: {} }));

vi.mock("../src/modules/order/repo.js", () => ({
  insertOrder: vi.fn(async () => {}),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { recordOrder: "court.order.record" },
  EVENTS: { orderRecorded: "court.order.recorded" },
}));

import { registerOrderConsumers } from "../src/modules/order/consumer.js";
import * as repo from "../src/modules/order/repo.js";
import { enqueue } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function recordMsg(id: string, actorId: string, messageId = id) {
  return {
    messageId, type: "court.order.record",
    tenantId: randomUUID(), actorId, correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(),
      orderType: "interim", orderText: "Bail granted subject to conditions.", orderDate: "2026-07-10",
    },
  };
}

describe("order consumer", () => {
  beforeEach(() => { processedIds.clear(); vi.clearAllMocks(); });

  it("records an order and emits orderRecorded + audit", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", recordMsg(randomUUID(), randomUUID()));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.order.recorded");
    expect(topics).toContain("audit.event.record");
  });

  it("record is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    const m = recordMsg(randomUUID(), randomUUID(), "fixed");
    await deliver("court.order.record", m);
    await deliver("court.order.record", m);
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("stamps signedBy = recording actor and dscSignature = null on the row", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    const actor = randomUUID();
    await deliver("court.order.record", recordMsg(randomUUID(), actor));
    const row = (repo.insertOrder as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      signedBy: string; dscSignature: string | null;
    };
    expect(row.signedBy).toBe(actor);
    expect(row.dscSignature).toBeNull();
  });
});
