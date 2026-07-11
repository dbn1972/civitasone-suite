/**
 * Consumer idempotency test for court-registry: the create-court and
 * create-bench handlers are exactly-once against the inbox. A second delivery
 * of the same messageId is a hard no-op (markProcessed → false → return before
 * any write). Shared I/O (db / outbox / repo) is mocked so the control flow is
 * exercised deterministically without a live Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, messageId: string) => {
    if (processedIds.has(messageId)) return false;
    processedIds.add(messageId);
    return true;
  }),
  enqueue: vi.fn(async () => {}),
}));

vi.mock("../src/modules/court-registry/repo.js", () => ({
  insertCourt: vi.fn(async () => {}),
  insertBench: vi.fn(async () => {}),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { createCourt: "court.court.create", createBench: "court.bench.create" },
  EVENTS: { courtRegistered: "court.court.registered", benchRegistered: "court.bench.registered" },
}));

import { registerCourtRegistryConsumers } from "../src/modules/court-registry/consumer.js";
import * as repo from "../src/modules/court-registry/repo.js";
import { enqueue } from "../src/shared/outbox.js";

/** Capture the (topic, handler) each module registers — mirrors the worker's
 *  registerConsumer(topic, handler) contract. */
function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return {
    register: register as never,
    deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg),
  };
}

function courtMsg(courtId: string, tenantId: string, actorId: string) {
  return {
    messageId: courtId,
    type: "court.court.create",
    tenantId, actorId, correlationId: "corr-1", schemaVersion: "1.0",
    payload: { id: courtId, tenantId, name: "Tehsildar Court, Sadar", courtType: "tehsildar", establishmentCode: "TEH-001" },
  };
}

describe("court-registry consumer — idempotency", () => {
  beforeEach(() => { processedIds.clear(); vi.clearAllMocks(); });

  it("processes the first create-court and enqueues courtRegistered + audit", async () => {
    const { register, deliver } = makeHarness();
    registerCourtRegistryConsumers(register);

    const courtId = randomUUID();
    await deliver("court.court.create", courtMsg(courtId, randomUUID(), randomUUID()));

    expect(repo.insertCourt).toHaveBeenCalledTimes(1);
    expect((repo.insertCourt as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ id: courtId, courtType: "tehsildar" });
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.court.registered");
    expect(topics).toContain("audit.event.record");
  });

  it("treats a redelivery of the same messageId as a no-op", async () => {
    const { register, deliver } = makeHarness();
    registerCourtRegistryConsumers(register);

    const courtId = randomUUID();
    const msg = courtMsg(courtId, randomUUID(), randomUUID());
    await deliver("court.court.create", msg);
    await deliver("court.court.create", msg);

    expect(repo.insertCourt).toHaveBeenCalledTimes(1);
    const registeredCount = (enqueue as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { topic: string }).topic === "court.court.registered").length;
    expect(registeredCount).toBe(1);
  });

  it("create-bench writes a bench and enqueues benchRegistered", async () => {
    const { register, deliver } = makeHarness();
    registerCourtRegistryConsumers(register);

    const benchId = randomUUID();
    const courtId = randomUUID();
    await deliver("court.bench.create", {
      messageId: benchId, type: "court.bench.create",
      tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
      payload: { id: benchId, courtId, tenantId: randomUUID(), name: "Court No. 1", benchType: "single" },
    });

    expect(repo.insertBench).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.bench.registered");
  });
});
