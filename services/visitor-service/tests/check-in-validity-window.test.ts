/**
 * DOM-012 (FIXED) — checkInRecord's commit path never checked the digital
 * pass's own validity window (`validFrom`/`validUntil`) at all.
 *
 * POST /v1/visitor/passes/verify (check-in/routes.ts) rejects an expired or
 * not-yet-active pass via the QR JWT's own exp/nbf claims (see
 * check-in/domain.ts's verifyQrForGate -> PASS_EXPIRED / PASS_NOT_YET_VALID,
 * driven by classifyQrError) — but that endpoint is only advisory
 * (SYNCHRONOUS, read-only, Requirement 5.1). POST /v1/visitor/check-ins
 * (check-in/routes.ts) never requires verify to have been called first, and
 * check-in/consumer.ts's checkInRecord, which is what actually COMMITS the
 * check-in, referenced neither `pass.validFrom` nor `pass.validUntil` at
 * all — exactly the same bypass shape as the gate/location/area scope and
 * revocation bugs fixed earlier in this same handler (see
 * check-in-bypasses-gate-scope.test.ts and
 * check-in-revocation-blacklist-bypass.test.ts).
 *
 * ORIGINAL BUG: an employee-role caller who knew a passId+gateId could
 * check in a pass before its validFrom or after its validUntil by hitting
 * POST /v1/visitor/check-ins directly, skipping verify entirely. Separately,
 * overstayDetect (same file) only catches a pass that is ALREADY checked_in
 * and has since drifted past validUntil — it never stopped the check-in
 * itself from being admitted in the first place.
 *
 * FIXED: checkInRecord now compares the claimed check-in `timestamp`
 * (payload.timestamp, or now()) against the loaded pass row's own
 * validFrom/validUntil immediately after the revocation check and before
 * any write, throwing NonRetryableError on either side of the window —
 * dead-lettered, the same convention the scope/revocation checks above
 * established for this exact commit path.
 *
 * This file mirrors check-in-revocation-blacklist-bypass.test.ts's mocking
 * harness exactly (same fakeTx select-call-order convention: 1=digitalPasses,
 * 2=gates, 3=visitRequests, 4=locations).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const isRevokedMock = vi.fn(async () => false);
const isBlacklistedMock = vi.fn(async () => false);
const isWatchlistedMock = vi.fn(async () => false);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";

// Fixed window, independent of wall-clock time so the test is deterministic:
// the pass is valid for exactly one day.
const VALID_FROM = new Date("2026-01-01T00:00:00.000Z");
const VALID_UNTIL = new Date("2026-01-02T00:00:00.000Z");
const BEFORE_WINDOW = new Date("2025-12-31T23:00:00.000Z"); // 1h before validFrom
const WITHIN_WINDOW = new Date("2026-01-01T12:00:00.000Z"); // mid-window
const AFTER_WINDOW = new Date("2026-01-02T01:00:00.000Z"); // 1h after validUntil

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
let gateRow: Record<string, unknown> | undefined;

// Ordered select responses: 1=digitalPasses, 2=gates, 3=visitRequests,
// 4=locations (matches checkInRecord's actual query order — see
// check-in-bypasses-gate-scope.test.ts).
function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
    if (!fakeTx.__n) fakeTx.__n = 0;
    fakeTx.__n++;
    if (fakeTx.__n === 1) return makeChain(passRow ? [passRow] : []);
    if (fakeTx.__n === 2) return makeChain(gateRow ? [gateRow] : []);
    if (fakeTx.__n === 3) return makeChain(visitRow ? [visitRow] : []);
    return makeChain([{ capacityThreshold: null }]); // locations — not exercised here
  }) as unknown as (() => ReturnType<typeof makeChain>) & { __n?: number },
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...a),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));

vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: vi.fn(async () => undefined),
  removeFromRoster: vi.fn(async () => undefined),
  getVisitorCount: vi.fn(async () => 0),
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => false,
}));

vi.mock("../src/modules/digital-pass/revocation-store.js", () => ({
  isRevoked: (...a: unknown[]) => isRevokedMock(...a),
}));

vi.mock("../src/modules/blacklist/screening-store.js", () => ({
  isBlacklisted: (...a: unknown[]) => isBlacklistedMock(...a),
  isWatchlisted: (...a: unknown[]) => isWatchlistedMock(...a),
}));

const { registerCheckInConsumers } = await import("../src/modules/check-in/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerCheckInConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 30): Promise<void> {
  await queue.publish(topic, { type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0", payload });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  isRevokedMock.mockReset().mockResolvedValue(false);
  isBlacklistedMock.mockReset().mockResolvedValue(false);
  isWatchlistedMock.mockReset().mockResolvedValue(false);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  fakeTx.__n = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, locationId: LOCATION_ID, visitRequestId: VISIT_REQUEST_ID,
    status: "active", passType: "single", permittedAreas: [],
    validFrom: VALID_FROM, validUntil: VALID_UNTIL,
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Visitor",
    visitorPhone: "9999999999", visitorCategory: "standard",
    identityDocRef: null, identityDocType: null,
  };
  // Real, tenant-scoped perimeter gate at the pass's own location — clears
  // the gate/location/area scope check trivially so it doesn't mask what
  // this file tests.
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
});

describe("checkInRecord validity-window check (DOM-012 fix)", () => {
  it("rejects (dead-letters) a check-in presented before the pass's validFrom, without ever reaching digitalPasses/checkIns writes", async () => {
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: BEFORE_WINDOW.toISOString() },
      600,
    );

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(queue.dlq[0]?.error).toContain("not yet valid");
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
    // Short-circuits before the visitRequests lookup (call #3) — only
    // digitalPasses + gates were queried, same ordering property the
    // revocation check established.
    expect(fakeTx.select).toHaveBeenCalledTimes(2);
  });

  it("rejects (dead-letters) a check-in presented after the pass's validUntil, without ever reaching digitalPasses/checkIns writes", async () => {
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: AFTER_WINDOW.toISOString() },
      600,
    );

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(queue.dlq[0]?.error).toContain("expired");
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(fakeTx.select).toHaveBeenCalledTimes(2);
  });

  it("positive control: a check-in presented within the pass's validity window still commits normally", async () => {
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: WITHIN_WINDOW.toISOString() },
    );

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });

  it("boundary: a check-in presented at exactly validFrom or exactly validUntil is still within the (inclusive) window and commits", async () => {
    const atStart = freshQueue();
    await publishAndFlush(
      atStart,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: VALID_FROM.toISOString() },
    );
    expect(atStart.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);

    fakeTx.select.mockClear();
    fakeTx.insert.mockClear();
    fakeTx.update.mockClear();
    fakeTx.__n = 0;
    markProcessedMock.mockClear().mockResolvedValue(true);

    const atEnd = freshQueue();
    await publishAndFlush(
      atEnd,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: VALID_UNTIL.toISOString() },
    );
    expect(atEnd.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
  });
});
