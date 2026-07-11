/**
 * case-parcel consumer tests — add idempotency and version-guarded update.
 * db/outbox/repo/schema/topics are mocked; the REAL NonRetryableError is used so
 * the not-found / version-conflict logic is genuinely exercised. Asserts that a
 * BigInt area is NEVER emitted raw — parcelAdded carries areaSqm as a string.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentParcel: { version: number; active: boolean } | undefined;

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

vi.mock("../src/modules/case-parcel/schema.js", () => ({ caseParcels: {} }));

vi.mock("../src/modules/case-parcel/repo.js", () => ({
  insertParcel: vi.fn(async () => {}),
  getParcelForUpdate: vi.fn(async () => currentParcel),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { addParcel: "court.parcel.add", updateParcel: "court.parcel.update" },
  EVENTS: { parcelAdded: "court.parcel.added", parcelUpdated: "court.parcel.updated" },
}));

import { registerParcelConsumers } from "../src/modules/case-parcel/consumer.js";
import * as repo from "../src/modules/case-parcel/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function addMsg(id: string, messageId = id, areaSqm: number | undefined = 5000) {
  return {
    messageId, type: "court.parcel.add",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(),
      surveyNumber: "12/3A", khasraNumber: "45", village: "Rampur",
      ...(areaSqm !== undefined ? { areaSqm } : {}), subjectType: "land",
    },
  };
}
function updateMsg(
  parcelId: string, expectedVersion: number,
  set: { active?: boolean; areaSqm?: number } = { active: false },
  messageId = randomUUID(),
) {
  return {
    messageId, type: "court.parcel.update",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { parcelId, tenantId: randomUUID(), expectedVersion, ...set },
  };
}

function emittedTopics() {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
}
function eventPayload(topic: string) {
  const call = (enqueue as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[1] as { topic: string }).topic === topic);
  return (call?.[1] as { payload: Record<string, unknown> }).payload;
}

describe("case-parcel consumer", () => {
  beforeEach(() => { processedIds.clear(); currentParcel = undefined; vi.clearAllMocks(); });

  it("adds a parcel and emits parcelAdded + audit, with areaSqm as a STRING (not a BigInt)", async () => {
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    await deliver("court.parcel.add", addMsg(randomUUID()));
    expect(repo.insertParcel).toHaveBeenCalledTimes(1);
    expect(emittedTopics()).toContain("court.parcel.added");
    expect(emittedTopics()).toContain("audit.event.record");
    const payload = eventPayload("court.parcel.added");
    expect(typeof payload.areaSqm).toBe("string");
    expect(payload.areaSqm).toBe("5000");
  });

  it("add is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    const m = addMsg(randomUUID(), "fixed");
    await deliver("court.parcel.add", m);
    await deliver("court.parcel.add", m);
    expect(repo.insertParcel).toHaveBeenCalledTimes(1);
  });

  it("rejects updating an unknown parcel (PARCEL_NOT_FOUND)", async () => {
    currentParcel = undefined;
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    await expect(deliver("court.parcel.update", updateMsg("nope", 1))).rejects.toThrow(/PARCEL_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token (VERSION_CONFLICT)", async () => {
    currentParcel = { version: 5, active: true };
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    await expect(deliver("court.parcel.update", updateMsg("p1", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("updates fields and soft-deactivates (active:false), emitting parcelUpdated", async () => {
    currentParcel = { version: 1, active: true };
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    await deliver("court.parcel.update", updateMsg("p1", 1, { active: false, areaSqm: 7200 }));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(emittedTopics()).toContain("court.parcel.updated");
    const payload = eventPayload("court.parcel.updated");
    expect(payload.active).toBe(false);
    expect(typeof payload.areaSqm).toBe("string"); // never a raw BigInt
  });

  it("is a no-op when active already at target and nothing else changes", async () => {
    currentParcel = { version: 1, active: true };
    const { register, deliver } = makeHarness();
    registerParcelConsumers(register);
    await deliver("court.parcel.update", updateMsg("p1", 1, { active: true }));
    expect(versionedUpdate).not.toHaveBeenCalled();
    expect(emittedTopics()).not.toContain("court.parcel.updated");
  });
});
