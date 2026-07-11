/**
 * Consumer idempotency test for case-registry. Proves the register-case
 * handler is exactly-once against the inbox: the first delivery writes the
 * case + parties + initial state transition and enqueues the caseRegistered
 * event, while a second delivery of the SAME messageId is a hard no-op
 * (markProcessed returns false → the handler returns before any write).
 *
 * Shared I/O (db / outbox / repo) is mocked so the test exercises the control
 * flow deterministically without a live Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

// --- inbox dedupe state, keyed by messageId (mirrors markProcessed semantics) ---
const processedIds = new Set<string>();

vi.mock("../src/shared/db.js", () => ({
  // transaction just runs the callback with a dummy tx handle.
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

vi.mock("../src/modules/case-registry/repo.js", () => ({
  insertCase: vi.fn(async () => {}),
  insertParties: vi.fn(async () => {}),
  insertStateTransition: vi.fn(async () => {}),
}));

// topics.js is a plain constant map; import the real one if present, else stub.
vi.mock("../src/topics.js", () => ({
  COMMANDS: { registerCase: "court.case.register" },
  EVENTS: { caseRegistered: "court.case.registered" },
}));

import { registerCaseRegistryConsumers } from "../src/modules/case-registry/consumer.js";
import * as repo from "../src/modules/case-registry/repo.js";
import { enqueue } from "../src/shared/outbox.js";

/** Test harness: capture the (topic, handler) the module registers, mirroring
 *  the worker registerConsumer(topic, handler) contract. */
function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return {
    register: register as never,
    deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg),
  };
}

function buildMessage(caseId: string, tenantId: string, actorId: string) {
  return {
    messageId: caseId,
    type: "court.case.register",
    tenantId,
    actorId,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload: {
      id: caseId,
      tenantId,
      cnrNumber: "DLHC010001234202",
      caseType: "civil",
      filingNumber: "F-2026-01",
      filingDate: "2026-07-01",
      title: "Rao v. State",
      courtId: randomUUID(),
      benchId: randomUUID(),
      parties: [
        { partyRole: "petitioner", name: "A. Rao", phone: "9990001111", email: "rao@example.gov.in" },
        { partyRole: "respondent", name: "State of Delhi" },
      ],
    },
  };
}

describe("registerCaseRegistry consumer — idempotency", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
  });

  it("processes the first delivery: writes case + parties + transition and enqueues event", async () => {
    const { register, deliver } = makeHarness();
    registerCaseRegistryConsumers(register);

    const caseId = randomUUID();
    await deliver("court.case.register", buildMessage(caseId, randomUUID(), randomUUID()));

    expect(repo.insertCase).toHaveBeenCalledTimes(1);
    expect(repo.insertParties).toHaveBeenCalledTimes(1);
    expect(repo.insertStateTransition).toHaveBeenCalledTimes(1);
    // Case inserted in 'filed' status with a null→filed initial transition.
    expect((repo.insertCase as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ id: caseId, status: "filed" });
    expect((repo.insertStateTransition as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ fromStatus: null, toStatus: "filed" });
    // caseRegistered + audit events enqueued in the same tx.
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.case.registered");
    expect(topics).toContain("audit.event.record");
  });

  it("treats a redelivery of the same messageId as a no-op", async () => {
    const { register, deliver } = makeHarness();
    registerCaseRegistryConsumers(register);

    const caseId = randomUUID();
    const msg = buildMessage(caseId, randomUUID(), randomUUID());

    await deliver("court.case.register", msg); // first delivery
    await deliver("court.case.register", msg); // duplicate delivery

    // Writes happened exactly once despite two deliveries.
    expect(repo.insertCase).toHaveBeenCalledTimes(1);
    expect(repo.insertParties).toHaveBeenCalledTimes(1);
    expect(repo.insertStateTransition).toHaveBeenCalledTimes(1);
    // No duplicate caseRegistered event on the second pass.
    const registeredCount = (enqueue as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[1] as { topic: string }).topic === "court.case.registered").length;
    expect(registeredCount).toBe(1);
  });
});
