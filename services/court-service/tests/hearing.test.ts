/**
 * hearing consumer tests — schedule idempotency and version-guarded adjournment.
 * db/outbox/repo/schema are mocked; the REAL state machine and NonRetryableError
 * are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentHearing: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/hearing/schema.js", () => ({ hearings: {} }));

vi.mock("../src/modules/hearing/repo.js", () => ({
  insertHearing: vi.fn(async () => {}),
  getHearingForUpdate: vi.fn(async () => currentHearing),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { scheduleHearing: "court.hearing.schedule", adjournHearing: "court.hearing.adjourn" },
  EVENTS: { hearingScheduled: "court.hearing.scheduled", hearingAdjourned: "court.hearing.adjourned" },
}));

import { registerHearingConsumers } from "../src/modules/hearing/consumer.js";
import * as repo from "../src/modules/hearing/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function scheduleMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.hearing.schedule",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, caseId: randomUUID(), tenantId: randomUUID(), scheduledAt: "2026-07-10T10:30:00.000Z", purpose: "arguments" },
  };
}
function adjournMsg(hearingId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.hearing.adjourn",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { hearingId, tenantId: randomUUID(), reason: "counsel unavailable", nextDate: "2026-07-24", expectedVersion },
  };
}

describe("hearing consumer", () => {
  beforeEach(() => { processedIds.clear(); currentHearing = undefined; vi.clearAllMocks(); });

  it("schedules a hearing and emits hearingScheduled + audit", async () => {
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    const id = randomUUID();
    await deliver("court.hearing.schedule", scheduleMsg(id));
    expect(repo.insertHearing).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.hearing.scheduled");
    expect(topics).toContain("audit.event.record");
  });

  it("schedule is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    const m = scheduleMsg(randomUUID(), "fixed");
    await deliver("court.hearing.schedule", m);
    await deliver("court.hearing.schedule", m);
    expect(repo.insertHearing).toHaveBeenCalledTimes(1);
  });

  it("adjourns a scheduled hearing (version-guarded) and emits hearingAdjourned", async () => {
    currentHearing = { status: "scheduled", version: 1 };
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    await deliver("court.hearing.adjourn", adjournMsg("h1", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.hearing.adjourned");
  });

  it("rejects adjourning a non-scheduled hearing (illegal transition)", async () => {
    currentHearing = { status: "held", version: 1 };
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    await expect(deliver("court.hearing.adjourn", adjournMsg("h1", 1))).rejects.toThrow(/INVALID_HEARING_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token", async () => {
    currentHearing = { status: "scheduled", version: 5 };
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    await expect(deliver("court.hearing.adjourn", adjournMsg("h1", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown hearing and is a no-op when already adjourned", async () => {
    const { register, deliver } = makeHarness();
    registerHearingConsumers(register);
    currentHearing = undefined;
    await expect(deliver("court.hearing.adjourn", adjournMsg("nope", 1))).rejects.toThrow(/HEARING_NOT_FOUND/);
    currentHearing = { status: "adjourned", version: 2 };
    await deliver("court.hearing.adjourn", adjournMsg("h1", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
