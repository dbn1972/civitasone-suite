/**
 * party consumer tests — add-party idempotency, version-guarded advocate update,
 * and the DPDP invariant that NO raw PII leaks into emitted event/audit payloads.
 * db/outbox/repo/schema/topics are mocked; the REAL NonRetryableError is used so
 * the not-found / version-conflict logic is genuinely exercised. The repo is
 * mocked so no real crypto runs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentParty: { version: number } | undefined;

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

vi.mock("../src/modules/party/schema.js", () => ({ caseParties: {} }));

vi.mock("../src/modules/party/repo.js", () => ({
  insertParty: vi.fn(async () => {}),
  getPartyForUpdate: vi.fn(async () => currentParty),
}));

vi.mock("../src/modules/config-registry/repo.js", () => ({
  listActiveKeys: vi.fn(async () => [] as string[]),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { addParty: "court.party.add", updateAdvocate: "court.party.update_advocate" },
  EVENTS: { partyAdded: "court.party.added", advocateUpdated: "court.party.advocate_updated" },
}));

import { registerPartyConsumers } from "../src/modules/party/consumer.js";
import * as repo from "../src/modules/party/repo.js";
import * as configRepo from "../src/modules/config-registry/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function addMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.party.add",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(), partyRole: "petitioner",
      name: "Ramesh Kumar", address: "12 MG Road, Delhi", phone: "9876543210", email: "ramesh@example.gov.in",
      advocateName: "Adv. S. Rao", advocateBarId: "D/1234/2020",
    },
  };
}
function updateMsg(partyId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.party.update_advocate",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { partyId, tenantId: randomUUID(), advocateName: "Adv. N. Iyer", advocateBarId: "D/5678/2021", expectedVersion },
  };
}

const enqueueMock = () => enqueue as ReturnType<typeof vi.fn>;
const emittedTopics = () => enqueueMock().mock.calls.map((c) => (c[1] as { topic: string }).topic);

describe("party consumer", () => {
  beforeEach(() => { processedIds.clear(); currentParty = undefined; vi.clearAllMocks(); });

  it("adds a party and emits partyAdded + audit with NO raw PII in any emitted payload", async () => {
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    const id = randomUUID();
    await deliver("court.party.add", addMsg(id));

    expect(repo.insertParty).toHaveBeenCalledTimes(1);
    const topics = emittedTopics();
    expect(topics).toContain("court.party.added");
    expect(topics).toContain("audit.event.record");

    // DPDP invariant: no name/address/phone/email anywhere in the emitted payloads.
    const forbidden = ["name", "address", "phone", "email"];
    for (const call of enqueueMock().mock.calls) {
      const payload = (call[1] as { payload: Record<string, unknown> }).payload;
      const serialized = JSON.stringify(payload);
      for (const f of forbidden) expect(payload).not.toHaveProperty(f);
      expect(serialized).not.toContain("Ramesh Kumar");
      expect(serialized).not.toContain("9876543210");
      expect(serialized).not.toContain("ramesh@example.gov.in");
    }
    // The partyAdded payload carries only ids + role.
    const added = enqueueMock().mock.calls.find((c) => (c[1] as { topic: string }).topic === "court.party.added");
    expect((added![1] as { payload: Record<string, unknown> }).payload).toEqual({ partyId: id, caseId: expect.any(String), partyRole: "petitioner" });
  });

  it("add-party is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    const m = addMsg(randomUUID(), "fixed");
    await deliver("court.party.add", m);
    await deliver("court.party.add", m);
    expect(repo.insertParty).toHaveBeenCalledTimes(1);
  });

  it("updates an advocate (version-guarded) and emits advocateUpdated", async () => {
    currentParty = { version: 1 };
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await deliver("court.party.update_advocate", updateMsg("p1", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(emittedTopics()).toContain("court.party.advocate_updated");
  });

  it("rejects an unknown party (PARTY_NOT_FOUND)", async () => {
    currentParty = undefined;
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await expect(deliver("court.party.update_advocate", updateMsg("nope", 1))).rejects.toThrow(/PARTY_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token (VERSION_CONFLICT)", async () => {
    currentParty = { version: 5 };
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await expect(deliver("court.party.update_advocate", updateMsg("p1", 1))).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});


describe("party consumer — config-driven partyRole (§47)", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
    (configRepo.listActiveKeys as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  function mk(partyRole: string) {
    const id = randomUUID();
    return {
      messageId: id, type: "court.party.add",
      tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
      payload: { id, caseId: randomUUID(), tenantId: randomUUID(), partyRole },
    };
  }

  it("rejects a partyRole that is neither a default nor tenant-configured", async () => {
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await expect(deliver("court.party.add", mk("made_up_role"))).rejects.toThrow(/INVALID_PARTY_ROLE/);
    expect(repo.insertParty).not.toHaveBeenCalled();
  });

  it("accepts a bespoke partyRole supplied ONLY by tenant config (nothing hardcoded)", async () => {
    (configRepo.listActiveKeys as ReturnType<typeof vi.fn>).mockResolvedValue(["amicus_curiae"]);
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await deliver("court.party.add", mk("amicus_curiae"));
    expect(repo.insertParty).toHaveBeenCalledTimes(1);
  });

  it("accepts a standard default partyRole with no tenant config", async () => {
    const { register, deliver } = makeHarness();
    registerPartyConsumers(register);
    await deliver("court.party.add", mk("petitioner"));
    expect(repo.insertParty).toHaveBeenCalledTimes(1);
  });
});
