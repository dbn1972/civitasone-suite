/**
 * case-lifecycle consumer tests — the enforced state machine + optimistic lock +
 * exactly-once idempotency. db/outbox/repo are mocked; the REAL state machine and
 * the REAL NonRetryableError are used so the transition/version logic is genuinely
 * exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateAfterCommit: vi.fn(async () => {}), makeKey: (...a: string[]) => a.join(":") },
  queue: { publish: vi.fn(async () => {}) },
}));
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentCase: { status: string; version: number } | undefined;

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
  versionedUpdate: vi.fn(async () => {}),
}));

vi.mock("../src/modules/case-registry/schema.js", () => ({ cases: {}, caseStateTransitions: {} }));

vi.mock("../src/modules/case-lifecycle/repo.js", () => ({
  getCaseForUpdate: vi.fn(async () => currentCase),
  appendStateTransition: vi.fn(async () => {}),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { updateCaseStatus: "court.case.update_status" },
  EVENTS: { caseStatusChanged: "court.case.status_changed" },
}));

import { registerCaseLifecycleConsumers } from "../src/modules/case-lifecycle/consumer.js";
import * as repo from "../src/modules/case-lifecycle/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function msg(caseId: string, toStatus: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.case.update_status",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { caseId, tenantId: randomUUID(), toStatus, expectedVersion },
  };
}

describe("case-lifecycle consumer", () => {
  beforeEach(() => { processedIds.clear(); currentCase = undefined; vi.clearAllMocks(); });

  it("applies a legal transition: version-guarded write + transition row + event", async () => {
    currentCase = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);

    await deliver("court.case.update_status", msg("case-1", "registered", 1));

    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(repo.appendStateTransition).toHaveBeenCalledTimes(1);
    expect((repo.appendStateTransition as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ fromStatus: "filed", toStatus: "registered" });
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.case.status_changed");
    expect(topics).toContain("audit.event.record");
  });

  it("rejects an ILLEGAL transition (NonRetryableable → DLQ) without writing", async () => {
    currentCase = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);

    await expect(deliver("court.case.update_status", msg("case-1", "disposed", 1))).rejects.toThrow(/INVALID_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a STALE optimistic-lock token (version conflict) without writing", async () => {
    currentCase = { status: "filed", version: 2 }; // moved on since the caller read v1
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);

    await expect(deliver("court.case.update_status", msg("case-1", "registered", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown case", async () => {
    currentCase = undefined;
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);
    await expect(deliver("court.case.update_status", msg("nope", "registered", 1))).rejects.toThrow(/CASE_NOT_FOUND/);
  });

  it("is a no-op when already at the target status", async () => {
    currentCase = { status: "registered", version: 3 };
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);
    await deliver("court.case.update_status", msg("case-1", "registered", 3));
    expect(versionedUpdate).not.toHaveBeenCalled();
    expect(repo.appendStateTransition).not.toHaveBeenCalled();
  });

  it("treats a redelivery of the same messageId as exactly-once", async () => {
    currentCase = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerCaseLifecycleConsumers(register);

    const m = msg("case-1", "registered", 1, "fixed-mid");
    await deliver("court.case.update_status", m);
    await deliver("court.case.update_status", m); // duplicate

    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(repo.appendStateTransition).toHaveBeenCalledTimes(1);
  });
});
