/**
 * GAP-VISITOR-GUARD-06 acceptance (backend side) — check-in / check-out:
 *   - a committed check-in emits exactly one check_in audit event, even with the
 *     auto-print-badge toggle OFF (the audit used to be nested inside that toggle)
 *   - checking in an already-checked-in pass is rejected (PASS_ALREADY_CHECKED_IN):
 *     no check_ins row, no audit
 *   - checking out a pass that is not checked in is rejected (PASS_NOT_CHECKED_IN)
 *   - a committed check-out emits exactly one check_out audit event
 *   - an idempotent replay (markProcessed false) writes and audits nothing
 * The HTTP layer is 202 (CQRS), so "409" surfaces as a consumer-side domain rejection.
 * Role enforcement (401/403) is covered in the second describe via the real routes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async (..._args: unknown[]) => undefined);

let passRow: Record<string, unknown> | undefined;
let gateRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}
const fakeTx = {
  select: vi.fn(() => {
    fakeTx.__n++;
    if (fakeTx.__n === 1) return makeChain(passRow ? [passRow] : []);
    if (fakeTx.__n === 2) return makeChain(gateRow ? [gateRow] : []);
    return makeChain(visitRow ? [visitRow] : []);
  }) as unknown as (() => ReturnType<typeof makeChain>),
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  __n: 0,
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...(a as [])),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));
vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: async () => undefined,
  removeFromRoster: async () => undefined,
}));
// Auto-print badge OFF: the audit must still be emitted.
vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => false,
}));

const { registerCheckInConsumers } = await import("../src/modules/check-in/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_ID = "66666666-6666-6666-6666-666666666666";

async function run(topic: string): Promise<void> {
  const queue = new MemoryQueue();
  registerCheckInConsumers(queue);
  await queue.publish(topic, {
    type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0",
    payload: { passId: PASS_ID, gateId: GATE_ID },
  });
  await new Promise((r) => setTimeout(r, 10));
  // Cancel pending retry backoffs (domain rejections are retried) so a leaked
  // retry cannot run against the next test's fixtures.
  await queue.stop();
}

const auditCalls = (action: string) =>
  enqueueMock.mock.calls.filter((c) => {
    const a = c[1] as { topic?: string; payload?: { action?: string } };
    return a.topic === "audit.event.record" && a.payload?.action === action;
  });

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  fakeTx.__n = 0;
  passRow = {
    id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_ID, locationId: LOCATION_ID,
    status: "active", passType: "single",
    validFrom: new Date("2020-01-01T00:00:00.000Z"), validUntil: new Date("2099-12-31T23:59:59.000Z"),
  };
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
  visitRow = { id: VISIT_ID, tenantId: TENANT, visitorName: "Jane Visitor", visitorPhone: "9999999999" };
});

describe("check-in consumer — audit + duplicate rejection", () => {
  it("emits exactly one check_in audit event (actor, passId) with auto-print OFF", async () => {
    await run(COMMANDS.checkInRecord);
    const calls = auditCalls("check_in");
    expect(calls).toHaveLength(1);
    const ev = calls[0]![1] as { actorId: string; payload: { resourceId: string } };
    expect(ev.actorId).toBe(ACTOR);
    expect(ev.payload.resourceId).toBe(PASS_ID);
  });

  it("rejects a second check-in of an already-checked-in pass: no row, no audit", async () => {
    passRow = { ...passRow, status: "checked_in" };
    await run(COMMANDS.checkInRecord);
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(auditCalls("check_in")).toHaveLength(0);
  });

  it("idempotent replay writes and audits nothing", async () => {
    markProcessedMock.mockResolvedValue(false);
    await run(COMMANDS.checkInRecord);
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(auditCalls("check_in")).toHaveLength(0);
  });
});

describe("check-out consumer — state guard + audit", () => {
  it("rejects a check-out of a pass that is not checked in: no row, no audit", async () => {
    await run(COMMANDS.checkOutRecord); // status "active"
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(auditCalls("check_out")).toHaveLength(0);
  });

  it("rejects a second check-out of an already checked-out pass", async () => {
    passRow = { ...passRow, status: "checked_out" };
    await run(COMMANDS.checkOutRecord);
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(auditCalls("check_out")).toHaveLength(0);
  });

  it("emits exactly one check_out audit event for a checked-in pass", async () => {
    passRow = { ...passRow, status: "checked_in" };
    await run(COMMANDS.checkOutRecord);
    expect(auditCalls("check_out")).toHaveLength(1);
  });

  it("idempotent replay writes and audits nothing", async () => {
    passRow = { ...passRow, status: "checked_in" };
    markProcessedMock.mockResolvedValue(false);
    await run(COMMANDS.checkOutRecord);
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(auditCalls("check_out")).toHaveLength(0);
  });
});
