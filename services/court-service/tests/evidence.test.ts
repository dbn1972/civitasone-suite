/**
 * evidence consumer tests — submit idempotency and version-guarded ruling.
 * db/outbox/repo/schema are mocked; the REAL state machine and NonRetryableError
 * are used so the transition/version logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentEvidence: { status: string; version: number } | undefined;

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

vi.mock("../src/modules/evidence/schema.js", () => ({ evidence: {} }));

vi.mock("../src/modules/evidence/repo.js", () => ({
  insertEvidence: vi.fn(async () => {}),
  getEvidenceForUpdate: vi.fn(async () => currentEvidence),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { submitEvidence: "court.evidence.submit", ruleOnEvidence: "court.evidence.rule" },
  EVENTS: { evidenceSubmitted: "court.evidence.submitted", evidenceRuled: "court.evidence.ruled" },
}));

import { registerEvidenceConsumers } from "../src/modules/evidence/consumer.js";
import * as repo from "../src/modules/evidence/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function submitMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.evidence.submit",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(),
      title: "Bank statement", evidenceType: "document",
      exhibitNumber: "P-1", storageRef: "s3://ev/p1.pdf", contentHash: "a".repeat(64),
    },
  };
}
function ruleMsg(evidenceId: string, ruling: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.evidence.rule",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { evidenceId, tenantId: randomUUID(), ruling, rulingRemarks: "relevant and authentic", expectedVersion },
  };
}

describe("evidence consumer", () => {
  beforeEach(() => { processedIds.clear(); currentEvidence = undefined; vi.clearAllMocks(); });

  it("submits an exhibit and emits evidenceSubmitted + audit", async () => {
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    const id = randomUUID();
    await deliver("court.evidence.submit", submitMsg(id));
    expect(repo.insertEvidence).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.evidence.submitted");
    expect(topics).toContain("audit.event.record");
  });

  it("submit is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    const m = submitMsg(randomUUID(), "fixed");
    await deliver("court.evidence.submit", m);
    await deliver("court.evidence.submit", m);
    expect(repo.insertEvidence).toHaveBeenCalledTimes(1);
  });

  it("rules on a submitted exhibit (version-guarded) and emits evidenceRuled, setting ruledBy/ruledAt", async () => {
    currentEvidence = { status: "submitted", version: 1 };
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    await deliver("court.evidence.rule", ruleMsg("e1", "admitted", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const call = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const args = call[2] as { set: { status: string; ruledBy: unknown; ruledAt: unknown } };
    expect(args.set.status).toBe("admitted");
    expect(args.set.ruledBy).toBeTruthy();
    expect(args.set.ruledAt).toBeInstanceOf(Date);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.evidence.ruled");
  });

  it("rejects an illegal ruling transition (already terminal)", async () => {
    currentEvidence = { status: "admitted", version: 1 };
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    await expect(deliver("court.evidence.rule", ruleMsg("e1", "rejected", 1))).rejects.toThrow(/INVALID_EVIDENCE_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token", async () => {
    currentEvidence = { status: "submitted", version: 5 };
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    await expect(deliver("court.evidence.rule", ruleMsg("e1", "admitted", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown exhibit and is a no-op when already at target ruling", async () => {
    const { register, deliver } = makeHarness();
    registerEvidenceConsumers(register);
    currentEvidence = undefined;
    await expect(deliver("court.evidence.rule", ruleMsg("nope", "admitted", 1))).rejects.toThrow(/EVIDENCE_NOT_FOUND/);
    currentEvidence = { status: "admitted", version: 2 };
    await deliver("court.evidence.rule", ruleMsg("e1", "admitted", 2));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
