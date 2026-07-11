/**
 * appeal consumer tests — file idempotency and version-guarded transitions (§25).
 * db/outbox/repo/schema are mocked; the REAL state machine and NonRetryableError
 * are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentAppeal: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/appeal/schema.js", () => ({ appeals: {} }));

vi.mock("../src/modules/appeal/repo.js", () => ({
  insertAppeal: vi.fn(async () => {}),
  getAppealForUpdate: vi.fn(async () => currentAppeal),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    fileAppeal: "court.appeal.file",
    registerAppeal: "court.appeal.register",
    decideAppeal: "court.appeal.decide",
    withdrawAppeal: "court.appeal.withdraw",
  },
  EVENTS: {
    appealFiled: "court.appeal.filed",
    appealStatusChanged: "court.appeal.status_changed",
  },
}));

import { registerAppealConsumers } from "../src/modules/appeal/consumer.js";
import * as repo from "../src/modules/appeal/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function fileMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.appeal.file",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, tenantId: randomUUID(), originalCaseId: randomUUID(), appealType: "appeal", grounds: "error of law", filedDate: "2026-07-10" },
  };
}
function registerMsg(appealId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.appeal.register",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { appealId, tenantId: randomUUID(), expectedVersion },
  };
}
function decideMsg(appealId: string, decision: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.appeal.decide",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { appealId, tenantId: randomUUID(), decision, decisionSummary: "reasoned order", decidedDate: "2026-07-24", expectedVersion },
  };
}
function withdrawMsg(appealId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.appeal.withdraw",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { appealId, tenantId: randomUUID(), expectedVersion },
  };
}

function enqueuedTopics() {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

describe("appeal consumer", () => {
  beforeEach(() => { processedIds.clear(); currentAppeal = undefined; vi.clearAllMocks(); });

  it("files an appeal and emits appealFiled + audit", async () => {
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    const id = randomUUID();
    await deliver("court.appeal.file", fileMsg(id));
    expect(repo.insertAppeal).toHaveBeenCalledTimes(1);
    const topics = enqueuedTopics();
    expect(topics).toContain("court.appeal.filed");
    expect(topics).toContain("audit.event.record");
  });

  it("file is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    const m = fileMsg(randomUUID(), "fixed");
    await deliver("court.appeal.file", m);
    await deliver("court.appeal.file", m);
    expect(repo.insertAppeal).toHaveBeenCalledTimes(1);
  });

  it("registers a filed appeal (version-guarded) and emits appealStatusChanged", async () => {
    currentAppeal = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    await deliver("court.appeal.register", registerMsg("a1", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(enqueuedTopics()).toContain("court.appeal.status_changed");
  });

  it("decides a registered appeal and sets decided fields", async () => {
    currentAppeal = { status: "registered", version: 2 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    await deliver("court.appeal.decide", decideMsg("a1", "allowed", 2));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const call = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const set = (call[2] as { set: Record<string, unknown> }).set;
    expect(set.status).toBe("allowed");
    expect(set.decidedDate).toBe("2026-07-24");
    expect(set.decisionSummary).toBe("reasoned order");
    expect(enqueuedTopics()).toContain("court.appeal.status_changed");
  });

  it("allows every decision outcome from registered", async () => {
    for (const decision of ["allowed", "dismissed", "remanded", "modified"] as const) {
      currentAppeal = { status: "registered", version: 1 };
      const { register, deliver } = makeHarness();
      registerAppealConsumers(register);
      await deliver("court.appeal.decide", decideMsg("a1", decision, 1));
      expect(versionedUpdate).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();
    }
  });

  it("withdraws a filed appeal and a registered appeal", async () => {
    currentAppeal = { status: "filed", version: 1 };
    let h = makeHarness();
    registerAppealConsumers(h.register);
    await h.deliver("court.appeal.withdraw", withdrawMsg("a1", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    currentAppeal = { status: "registered", version: 3 };
    h = makeHarness();
    registerAppealConsumers(h.register);
    await h.deliver("court.appeal.withdraw", withdrawMsg("a1", 3));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects deciding a filed (not-yet-registered) appeal (illegal transition)", async () => {
    currentAppeal = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    await expect(deliver("court.appeal.decide", decideMsg("a1", "allowed", 1))).rejects.toThrow(/INVALID_APPEAL_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects transitioning a terminal appeal (illegal transition)", async () => {
    currentAppeal = { status: "dismissed", version: 4 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    await expect(deliver("court.appeal.register", registerMsg("a1", 4))).rejects.toThrow(/INVALID_APPEAL_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token", async () => {
    currentAppeal = { status: "registered", version: 5 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    await expect(deliver("court.appeal.decide", decideMsg("a1", "allowed", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown appeal and is a no-op when already at target status", async () => {
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    currentAppeal = undefined;
    await expect(deliver("court.appeal.register", registerMsg("nope", 1))).rejects.toThrow(/APPEAL_NOT_FOUND/);
    currentAppeal = { status: "registered", version: 2 };
    await deliver("court.appeal.register", registerMsg("a1", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("register is exactly-once on redelivery", async () => {
    currentAppeal = { status: "filed", version: 1 };
    const { register, deliver } = makeHarness();
    registerAppealConsumers(register);
    const m = registerMsg("a1", 1, "reg-fixed");
    await deliver("court.appeal.register", m);
    await deliver("court.appeal.register", m);
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
  });
});
