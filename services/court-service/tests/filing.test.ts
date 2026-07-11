/**
 * filing consumer tests — submit idempotency and the money-conservation guard.
 * db/outbox/repo/topics are mocked; the REAL money guard and NonRetryableError
 * are used so the poison-message logic is genuinely exercised.
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

vi.mock("../src/modules/filing/repo.js", () => ({
  insertFiling: vi.fn(async () => {}),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { submitFiling: "court.filing.submit" },
  EVENTS: { filingSubmitted: "court.filing.submitted" },
}));

import { registerFilingConsumers } from "../src/modules/filing/consumer.js";
import * as repo from "../src/modules/filing/repo.js";
import { enqueue } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function submitMsg(id: string, messageId = id, overrides: Record<string, unknown> = {}) {
  return {
    messageId, type: "court.filing.submit",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, caseId: randomUUID(), tenantId: randomUUID(), filingType: "plaint", filingFeeMinor: 15000, courtFeeMinor: 5000, ...overrides },
  };
}

describe("filing consumer", () => {
  beforeEach(() => { processedIds.clear(); vi.clearAllMocks(); });

  it("submits a filing and emits filingSubmitted + audit", async () => {
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    const id = randomUUID();
    await deliver("court.filing.submit", submitMsg(id));
    expect(repo.insertFiling).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.filing.submitted");
    expect(topics).toContain("audit.event.record");
  });

  it("submit is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    const m = submitMsg(randomUUID(), "fixed");
    await deliver("court.filing.submit", m);
    await deliver("court.filing.submit", m);
    expect(repo.insertFiling).toHaveBeenCalledTimes(1);
  });

  it("rejects a negative fee (poison message) and does NOT insert", async () => {
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    await expect(
      deliver("court.filing.submit", submitMsg(randomUUID(), undefined, { courtFeeMinor: -1 })),
    ).rejects.toThrow(/INVALID_FEE/);
    expect(repo.insertFiling).not.toHaveBeenCalled();
  });
});
