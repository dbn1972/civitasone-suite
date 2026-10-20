/**
 * Domain rejections in the check-in / check-out consumers are permanent, so they
 * must be dead-lettered on the FIRST attempt (NonRetryableError), not retried the
 * bus's full 5 attempts. A transient infrastructure failure must still retry.
 *
 * Harness mirrors check-in-validity-window.test.ts (select-call order:
 * 1=digitalPasses, 2=gates, 3=visitRequests, 4=locations).
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

describe("check-in consumers: DomainError is non-retryable, infrastructure errors still retry", () => {
  it("check-in of an already checked-in pass (DomainError PASS_ALREADY_CHECKED_IN) is attempted ONCE and dead-lettered", async () => {
    passRow = { ...passRow, status: "checked_in" };
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: WITHIN_WINDOW.toISOString() },
      700,
    );
    expect(markProcessedMock).toHaveBeenCalledTimes(1); // one attempt, no retries
    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]?.error).toContain("PASS_ALREADY_CHECKED_IN");
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("check-out of a pass that is not checked in (DomainError) is attempted ONCE and dead-lettered", async () => {
    passRow = { ...passRow, status: "active" };
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkOutRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: WITHIN_WINDOW.toISOString() },
      700,
    );
    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(1);
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("a transient infrastructure error (plain Error from the DB) is still retried with backoff", async () => {
    fakeTx.insert.mockImplementation(() => { throw new Error("connection reset by peer"); });
    // Each retry opens a fresh transaction: restart the ordered-select counter.
    markProcessedMock.mockImplementation(async () => { fakeTx.__n = 0; return true; });
    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.checkInRecord,
      { passId: PASS_ID, gateId: GATE_ID, timestamp: WITHIN_WINDOW.toISOString() },
      1500,
    );
    expect(markProcessedMock.mock.calls.length).toBeGreaterThan(1); // retried
    expect(fakeTx.insert.mock.calls.length).toBe(markProcessedMock.mock.calls.length); // every attempt reached the write
    fakeTx.insert.mockImplementation(() => ({ values: async () => undefined }));
  });

  it("isDomainRejection recognises every per-module DomainError by name, and nothing else", async () => {
    const { isDomainRejection } = await import("../src/shared/domain-rejection.js");
    const { DomainError: LocationDomainError } = await import("../src/modules/location/domain.js");
    const { DomainError: CheckInDomainError } = await import("../src/modules/check-in/domain.js");
    expect(isDomainRejection(new CheckInDomainError("X", "y"))).toBe(true);
    expect(isDomainRejection(new LocationDomainError("X", "y"))).toBe(true); // sets no .name; matched by class name
    expect(isDomainRejection(new Error("boom"))).toBe(false);
    expect(isDomainRejection("DomainError")).toBe(false);
  });
});
