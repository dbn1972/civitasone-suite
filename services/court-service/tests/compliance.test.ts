/**
 * compliance consumer tests — direction creation idempotency and version-guarded
 * updates (§26). db/outbox/repo/schema are mocked; the REAL state machine and
 * NonRetryableError are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentDirection: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/compliance/schema.js", () => ({ complianceDirections: {} }));

vi.mock("../src/modules/compliance/repo.js", () => ({
  insertDirection: vi.fn(async () => {}),
  getDirectionForUpdate: vi.fn(async () => currentDirection),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { createDirection: "court.compliance.direct", updateCompliance: "court.compliance.update" },
  EVENTS: { complianceDirected: "court.compliance.directed", complianceUpdated: "court.compliance.updated" },
}));

import { registerComplianceConsumers } from "../src/modules/compliance/consumer.js";
import * as repo from "../src/modules/compliance/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function directMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.compliance.direct",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, caseId: randomUUID(), tenantId: randomUUID(), orderId: randomUUID(), direction: "file compliance report", responsibleAuthority: "SHO", dueDate: "2026-08-01" },
  };
}
function updateMsg(directionId: string, status: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.compliance.update",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { directionId, tenantId: randomUUID(), status, progressNotes: "report filed", expectedVersion },
  };
}

describe("compliance consumer", () => {
  beforeEach(() => { processedIds.clear(); currentDirection = undefined; vi.clearAllMocks(); });

  it("creates a direction and emits complianceDirected + audit", async () => {
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    const id = randomUUID();
    await deliver("court.compliance.direct", directMsg(id));
    expect(repo.insertDirection).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.compliance.directed");
    expect(topics).toContain("audit.event.record");
  });

  it("create is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    const m = directMsg(randomUUID(), "fixed");
    await deliver("court.compliance.direct", m);
    await deliver("court.compliance.direct", m);
    expect(repo.insertDirection).toHaveBeenCalledTimes(1);
  });

  it("updates a pending direction (version-guarded) and emits complianceUpdated", async () => {
    currentDirection = { status: "pending", version: 1 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await deliver("court.compliance.update", updateMsg("d1", "in_progress", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.compliance.updated");
  });

  it("rejects an unknown direction (DIRECTION_NOT_FOUND)", async () => {
    currentDirection = undefined;
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await expect(deliver("court.compliance.update", updateMsg("nope", "in_progress", 1))).rejects.toThrow(/DIRECTION_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token (VERSION_CONFLICT)", async () => {
    currentDirection = { status: "pending", version: 5 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await expect(deliver("court.compliance.update", updateMsg("d1", "in_progress", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition", async () => {
    currentDirection = { status: "pending", version: 1 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await expect(deliver("court.compliance.update", updateMsg("d1", "verified", 1))).rejects.toThrow(/INVALID_COMPLIANCE_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when already at the target status", async () => {
    currentDirection = { status: "in_progress", version: 2 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await deliver("court.compliance.update", updateMsg("d1", "in_progress", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("stamps closedAt when the target status is terminal", async () => {
    currentDirection = { status: "in_progress", version: 3 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await deliver("court.compliance.update", updateMsg("d1", "non_compliant", 3));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const args = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { set: { closedAt?: unknown } };
    expect(args.set.closedAt).toBeInstanceOf(Date);
  });

  it("does NOT stamp closedAt on a non-terminal transition", async () => {
    currentDirection = { status: "pending", version: 1 };
    const { register, deliver } = makeHarness();
    registerComplianceConsumers(register);
    await deliver("court.compliance.update", updateMsg("d1", "in_progress", 1));
    const args = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { set: { closedAt?: unknown } };
    expect(args.set.closedAt).toBeUndefined();
  });
});
