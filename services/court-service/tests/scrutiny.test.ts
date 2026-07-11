/**
 * scrutiny consumer tests — record/raise idempotency and version-guarded defect
 * resolution. db/outbox/repo/schema/topics are mocked; the REAL state machine and
 * NonRetryableError are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentDefect: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/scrutiny/schema.js", () => ({ caseScrutiny: {}, caseDefect: {} }));

vi.mock("../src/modules/scrutiny/repo.js", () => ({
  insertScrutiny: vi.fn(async () => {}),
  insertDefect: vi.fn(async () => {}),
  getDefectForUpdate: vi.fn(async () => currentDefect),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    recordScrutiny: "court.scrutiny.record",
    raiseDefect: "court.defect.raise",
    resolveDefect: "court.defect.resolve",
  },
  EVENTS: {
    scrutinyRecorded: "court.scrutiny.recorded",
    defectRaised: "court.defect.raised",
    defectResolved: "court.defect.resolved",
  },
}));

import { registerScrutinyConsumers } from "../src/modules/scrutiny/consumer.js";
import * as repo from "../src/modules/scrutiny/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function recordMsg(id: string, messageId = id, status?: string) {
  return {
    messageId, type: "court.scrutiny.record",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, caseId: randomUUID(), tenantId: randomUUID(), status, remarks: "checked" },
  };
}
function raiseMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.defect.raise",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(), scrutinyId: randomUUID(),
      category: "missing_vakalatnama", description: "vakalatnama not filed", severity: "major",
      rectificationDeadline: "2026-07-25",
    },
  };
}
function resolveMsg(defectId: string, resolution: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.defect.resolve",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { defectId, tenantId: randomUUID(), resolution, expectedVersion },
  };
}

describe("scrutiny consumer", () => {
  beforeEach(() => { processedIds.clear(); currentDefect = undefined; vi.clearAllMocks(); });

  it("records a scrutiny and emits scrutinyRecorded + audit", async () => {
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    const id = randomUUID();
    await deliver("court.scrutiny.record", recordMsg(id, id, "cleared"));
    expect(repo.insertScrutiny).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.scrutiny.recorded");
    expect(topics).toContain("audit.event.record");
  });

  it("record is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    const m = recordMsg(randomUUID(), "fixed");
    await deliver("court.scrutiny.record", m);
    await deliver("court.scrutiny.record", m);
    expect(repo.insertScrutiny).toHaveBeenCalledTimes(1);
  });

  it("raises a defect and emits defectRaised + audit", async () => {
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    const id = randomUUID();
    await deliver("court.defect.raise", raiseMsg(id));
    expect(repo.insertDefect).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.defect.raised");
    expect(topics).toContain("audit.event.record");
  });

  it("raise is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    const m = raiseMsg(randomUUID(), "fixed-defect");
    await deliver("court.defect.raise", m);
    await deliver("court.defect.raise", m);
    expect(repo.insertDefect).toHaveBeenCalledTimes(1);
  });

  it("resolves a raised defect (version-guarded) and emits defectResolved", async () => {
    currentDefect = { status: "raised", version: 1 };
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    await deliver("court.defect.resolve", resolveMsg("d1", "rectified", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.defect.resolved");
  });

  it("rejects resolving an unknown defect (DEFECT_NOT_FOUND)", async () => {
    currentDefect = undefined;
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    await expect(deliver("court.defect.resolve", resolveMsg("nope", "waived", 1))).rejects.toThrow(/DEFECT_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token (VERSION_CONFLICT)", async () => {
    currentDefect = { status: "raised", version: 5 };
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    await expect(deliver("court.defect.resolve", resolveMsg("d1", "rectified", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an illegal defect transition and is a no-op when already resolved", async () => {
    currentDefect = { status: "rectified", version: 2 };
    const { register, deliver } = makeHarness();
    registerScrutinyConsumers(register);
    // already in target state → no-op (returns before version check / update)
    await deliver("court.defect.resolve", resolveMsg("d1", "rectified", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
    // resolved → different resolution is an illegal transition
    await expect(deliver("court.defect.resolve", resolveMsg("d1", "waived", 2))).rejects.toThrow(/INVALID_DEFECT_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
