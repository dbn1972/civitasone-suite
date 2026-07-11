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

vi.mock("../src/modules/config-registry/repo.js", () => ({
  getConfigValueOnTx: vi.fn(async () => undefined),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { submitFiling: "court.filing.submit" },
  EVENTS: { filingSubmitted: "court.filing.submitted" },
}));

import { registerFilingConsumers } from "../src/modules/filing/consumer.js";
import * as repo from "../src/modules/filing/repo.js";
import * as configRepo from "../src/modules/config-registry/repo.js";
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

describe("filing consumer — fee_schedule (§47 authoritative fees)", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
    (configRepo.getConfigValueOnTx as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("uses client-supplied fees when no fee_schedule is configured", async () => {
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    await deliver("court.filing.submit", submitMsg(randomUUID(), undefined, { filingFeeMinor: 15000, courtFeeMinor: 5000 }));
    expect((repo.insertFiling as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ filingFeeMinor: 15000, courtFeeMinor: 5000 });
  });

  it("SERVER config fee overrides a client-supplied (tampered-low) amount", async () => {
    (configRepo.getConfigValueOnTx as ReturnType<typeof vi.fn>).mockResolvedValue({ filingFeeMinor: 25000, courtFeeMinor: 10000 });
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    await deliver("court.filing.submit", submitMsg(randomUUID(), undefined, { filingFeeMinor: 1, courtFeeMinor: 1 }));
    expect((repo.insertFiling as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ filingFeeMinor: 25000, courtFeeMinor: 10000 });
    const evt = (enqueue as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[1] as { topic: string; payload?: { feeSource?: string } })
      .find((e) => e.topic === "court.filing.submitted");
    expect(evt?.payload?.feeSource).toBe("config");
  });

  it("rejects a malformed fee_schedule value (poison) and does NOT insert", async () => {
    (configRepo.getConfigValueOnTx as ReturnType<typeof vi.fn>).mockResolvedValue({ filingFeeMinor: -5, courtFeeMinor: 10 });
    const { register, deliver } = makeHarness();
    registerFilingConsumers(register);
    await expect(deliver("court.filing.submit", submitMsg(randomUUID()))).rejects.toThrow(/INVALID_FEE_SCHEDULE/);
    expect(repo.insertFiling).not.toHaveBeenCalled();
  });
});
