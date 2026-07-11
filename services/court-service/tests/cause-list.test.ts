/**
 * cause-list consumer tests — generation idempotency, missing-list guard, and
 * the double-booking guard that maps a btree_gist EXCLUDE (23P01) / unique (23505)
 * violation onto a NonRetryableError. db/outbox/repo/schema/topics are mocked;
 * the REAL NonRetryableError is used so the mapping is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentList: { id: string; listDate: string; courtId: string } | undefined;
let insertItemImpl: () => Promise<void> = async () => {};

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

vi.mock("../src/modules/cause-list/schema.js", () => ({ causeLists: {}, causeListItems: {} }));

vi.mock("../src/modules/cause-list/repo.js", () => ({
  insertCauseList: vi.fn(async () => {}),
  getCauseList: vi.fn(async () => currentList),
  insertCauseListItem: vi.fn(async () => insertItemImpl()),
  // real semantics: 23505 unique or 23P01 exclusion violation
  isUniqueViolation: (err: unknown) => {
    const code = (err as { code?: string } | null)?.code;
    return code === "23505" || code === "23P01";
  },
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    generateCauseList: "court.causelist.generate",
    listCaseOnCauseList: "court.causelist.list_case",
  },
  EVENTS: {
    causeListGenerated: "court.causelist.generated",
    causeListItemAdded: "court.causelist.item_added",
  },
}));

import { registerCauseListConsumers } from "../src/modules/cause-list/consumer.js";
import * as repo from "../src/modules/cause-list/repo.js";
import { enqueue } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function generateMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.causelist.generate",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { id, tenantId: randomUUID(), courtId: randomUUID(), listDate: "2026-07-11", listType: "regular" },
  };
}
function listCaseMsg(causeListId: string, messageId = randomUUID()) {
  return {
    messageId, type: "court.causelist.list_case",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id: randomUUID(), causeListId, tenantId: randomUUID(), caseId: randomUUID(),
      itemNumber: 1, slot: "10:30", courtroom: "CR-1",
    },
  };
}

function topicsOf() {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

describe("cause-list consumer", () => {
  beforeEach(() => {
    processedIds.clear();
    currentList = undefined;
    insertItemImpl = async () => {};
    vi.clearAllMocks();
  });

  it("generates a cause-list (draft) and emits causeListGenerated + audit", async () => {
    const { register, deliver } = makeHarness();
    registerCauseListConsumers(register);
    await deliver("court.causelist.generate", generateMsg(randomUUID()));
    expect(repo.insertCauseList).toHaveBeenCalledTimes(1);
    const topics = topicsOf();
    expect(topics).toContain("court.causelist.generated");
    expect(topics).toContain("audit.event.record");
  });

  it("generation is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerCauseListConsumers(register);
    const m = generateMsg(randomUUID(), "fixed");
    await deliver("court.causelist.generate", m);
    await deliver("court.causelist.generate", m);
    expect(repo.insertCauseList).toHaveBeenCalledTimes(1);
  });

  it("rejects listing a case onto a missing cause-list (CAUSELIST_NOT_FOUND)", async () => {
    currentList = undefined;
    const { register, deliver } = makeHarness();
    registerCauseListConsumers(register);
    await expect(deliver("court.causelist.list_case", listCaseMsg("nope")))
      .rejects.toThrow(/CAUSELIST_NOT_FOUND/);
    expect(repo.insertCauseListItem).not.toHaveBeenCalled();
  });

  it("maps a double-booking (23P01 exclusion) to CAUSELIST_SLOT_CONFLICT", async () => {
    currentList = { id: "l1", listDate: "2026-07-11", courtId: randomUUID() };
    insertItemImpl = async () => { throw Object.assign(new Error("exclusion_violation"), { code: "23P01" }); };
    const { register, deliver } = makeHarness();
    registerCauseListConsumers(register);
    await expect(deliver("court.causelist.list_case", listCaseMsg("l1")))
      .rejects.toThrow(/CAUSELIST_SLOT_CONFLICT/);
  });

  it("lists a case onto a cause-list and emits causeListItemAdded + audit", async () => {
    currentList = { id: "l1", listDate: "2026-07-11", courtId: randomUUID() };
    const { register, deliver } = makeHarness();
    registerCauseListConsumers(register);
    await deliver("court.causelist.list_case", listCaseMsg("l1"));
    expect(repo.insertCauseListItem).toHaveBeenCalledTimes(1);
    const topics = topicsOf();
    expect(topics).toContain("court.causelist.item_added");
    expect(topics).toContain("audit.event.record");
  });
});
