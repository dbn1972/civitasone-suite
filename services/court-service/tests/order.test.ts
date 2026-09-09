/**
 * order consumer tests — record insert/emit and exactly-once redelivery.
 * db/outbox/repo/schema/topics are mocked; the REAL NonRetryableError is used.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
// DOM-003 — case/hearing guard fixtures. Default: an open case, no hearing
// cited. Individual tests override these to exercise the guards.
let currentCase: { status: string } | undefined = { status: "pending" };
let currentHearing: { status: string; version: number; caseId: string } | undefined;

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

vi.mock("../src/modules/order/schema.js", () => ({ orders: {} }));

vi.mock("../src/modules/order/repo.js", () => ({
  insertOrder: vi.fn(async () => {}),
}));

vi.mock("../src/modules/config-registry/repo.js", () => ({
  listActiveKeys: vi.fn(async () => [] as string[]),
}));

vi.mock("../src/modules/case-registry/repo.js", () => ({
  getCaseForUpdate: vi.fn(async () => currentCase),
}));

vi.mock("../src/modules/hearing/repo.js", () => ({
  getHearingForUpdate: vi.fn(async () => currentHearing),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { recordOrder: "court.order.record" },
  EVENTS: { orderRecorded: "court.order.recorded" },
}));

import { registerOrderConsumers } from "../src/modules/order/consumer.js";
import * as repo from "../src/modules/order/repo.js";
import * as configRepo from "../src/modules/config-registry/repo.js";
import { enqueue } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function recordMsg(id: string, actorId: string, messageId = id) {
  return {
    messageId, type: "court.order.record",
    tenantId: randomUUID(), actorId, correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, caseId: randomUUID(), tenantId: randomUUID(),
      orderType: "interim", orderText: "Bail granted subject to conditions.", orderDate: "2026-07-10",
    },
  };
}

describe("order consumer", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
    currentCase = { status: "pending" };
    currentHearing = undefined;
  });

  it("records an order and emits orderRecorded + audit", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", recordMsg(randomUUID(), randomUUID()));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.order.recorded");
    expect(topics).toContain("audit.event.record");
  });

  it("record is exactly-once on redelivery", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    const m = recordMsg(randomUUID(), randomUUID(), "fixed");
    await deliver("court.order.record", m);
    await deliver("court.order.record", m);
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("stamps signedBy = recording actor and dscSignature = null on the row", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    const actor = randomUUID();
    await deliver("court.order.record", recordMsg(randomUUID(), actor));
    const row = (repo.insertOrder as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      signedBy: string; dscSignature: string | null;
    };
    expect(row.signedBy).toBe(actor);
    expect(row.dscSignature).toBeNull();
  });
});


describe("order consumer — config-driven orderType (§47)", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
    currentCase = { status: "pending" };
    currentHearing = undefined;
    (configRepo.listActiveKeys as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  function mk(orderType: string) {
    const id = randomUUID();
    return {
      messageId: id, type: "court.order.record",
      tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
      payload: {
        id, caseId: randomUUID(), tenantId: randomUUID(),
        orderType, orderText: "X", orderDate: "2026-07-10",
      },
    };
  }

  it("rejects an orderType that is neither a default nor tenant-configured", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mk("made_up_type"))).rejects.toThrow(/INVALID_ORDER_TYPE/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("accepts a bespoke orderType supplied ONLY by tenant config (nothing hardcoded)", async () => {
    (configRepo.listActiveKeys as ReturnType<typeof vi.fn>).mockResolvedValue(["special_order"]);
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", mk("special_order"));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("accepts a standard default orderType with no tenant config", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", mk("interim"));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });
});


/**
 * DOM-003 — order recording had no case-state or hearing-ownership gate:
 * an order could be recorded against a case already in a terminal
 * (disposed/appealed) status, and an order could cite a hearingId with no
 * verification that the hearing actually belongs to the case being acted
 * on, or that the hearing had actually concluded (`held`). Both guards run
 * as real DB reads inside the SAME transaction as the insert (see
 * caseRepo.getCaseForUpdate / hearingRepo.getHearingForUpdate mocks above)
 * — never inferred from anything the client submitted.
 */
describe("order consumer — DOM-003 case-state and hearing-ownership guards", () => {
  beforeEach(() => {
    processedIds.clear();
    vi.clearAllMocks();
    currentCase = { status: "pending" };
    currentHearing = undefined;
  });

  function mkForCase(caseId: string, hearingId?: string) {
    const id = randomUUID();
    return {
      messageId: id, type: "court.order.record",
      tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
      payload: {
        id, caseId, tenantId: randomUUID(),
        ...(hearingId ? { hearingId } : {}),
        orderType: "interim", orderText: "Bail granted subject to conditions.", orderDate: "2026-07-10",
      },
    };
  }

  it("rejects recording an order against a case that does not exist", async () => {
    currentCase = undefined;
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(randomUUID()))).rejects.toThrow(/CASE_NOT_FOUND/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("rejects recording an order against a case already in a terminal (disposed) state", async () => {
    currentCase = { status: "disposed" };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(randomUUID()))).rejects.toThrow(/CASE_TERMINAL/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("rejects recording an order against a case already in a terminal (appealed) state", async () => {
    currentCase = { status: "appealed" };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(randomUUID()))).rejects.toThrow(/CASE_TERMINAL/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("allows recording an order against a case in a non-terminal state (control)", async () => {
    currentCase = { status: "pending" };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", mkForCase(randomUUID()));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("rejects an order that cites a hearing belonging to a DIFFERENT case (foreign hearing)", async () => {
    const caseId = randomUUID();
    const foreignCaseId = randomUUID();
    const hearingId = randomUUID();
    currentHearing = { status: "held", version: 1, caseId: foreignCaseId };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(caseId, hearingId)))
      .rejects.toThrow(/HEARING_CASE_MISMATCH/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("rejects an order that cites a hearing that has not been held yet (still scheduled)", async () => {
    const caseId = randomUUID();
    const hearingId = randomUUID();
    currentHearing = { status: "scheduled", version: 1, caseId };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(caseId, hearingId)))
      .rejects.toThrow(/HEARING_NOT_HELD/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("rejects an order that cites an unknown hearingId", async () => {
    const caseId = randomUUID();
    const hearingId = randomUUID();
    currentHearing = undefined;
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await expect(deliver("court.order.record", mkForCase(caseId, hearingId)))
      .rejects.toThrow(/HEARING_NOT_FOUND/);
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });

  it("allows an order citing a hearing that genuinely belongs to this case and is held (control)", async () => {
    const caseId = randomUUID();
    const hearingId = randomUUID();
    currentHearing = { status: "held", version: 1, caseId };
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", mkForCase(caseId, hearingId));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("allows an order with no hearingId cited at all — hearing linkage is optional (control)", async () => {
    const { register, deliver } = makeHarness();
    registerOrderConsumers(register);
    await deliver("court.order.record", mkForCase(randomUUID()));
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });
});
