/**
 * Regression test: PR #707's rebase onto main after #705 merged.
 *
 * #705 (main) wired `assertWithinCapacity` (location/domain.ts, Property 28)
 * into checkInRecord's commit path as a PRE-COMMIT enforcement check — a
 * location at/over its configured capacityThreshold now rejects a new
 * check-in instead of merely alerting after admitting it (see
 * check-in/consumer.ts's own comment above the capacity-check block). This
 * PR's branch was cut before #705 merged, and item 7 (gate/location/area
 * scope re-assertion, see check-in-bypasses-gate-scope.test.ts) landed in
 * the exact same region of the same function on this branch — a real
 * textual merge conflict when rebasing onto post-#705 main.
 *
 * `assertWithinCapacity` itself already has full unit coverage in isolation
 * (tests/location-domain-gaps.test.ts) — that file's own header comment,
 * written before #705 wired it up, documents it as "dead code ... NEVER
 * called anywhere in the service." This file closes exactly the gap that
 * comment describes: proof that the CONSUMER actually calls it, wired
 * correctly, at commit time — not just that the pure function behaves
 * correctly on its own. Without a test at this level, a conflict-resolution
 * mistake during the rebase (e.g. quietly dropping the pre-commit capacity
 * block while reconciling it against item 7's scope check) would have
 * shipped silently — nothing else in this suite would have caught it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const getVisitorCountMock = vi.fn(async () => 0);
const isRevokedMock = vi.fn(async () => false);
const isBlacklistedMock = vi.fn(async () => false);
const isWatchlistedMock = vi.fn(async () => false);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";
const CAPACITY_THRESHOLD = 50;

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
let gateRow: Record<string, unknown> | undefined;
let locationRow: Record<string, unknown> | undefined;

// Ordered select responses: 1=digitalPasses, 2=gates, 3=visitRequests,
// 4=locations — matches checkInRecord's actual query order (see
// check-in-bypasses-gate-scope.test.ts / check-in-vip-badge.test.ts).
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
    return makeChain(locationRow ? [locationRow] : []);
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
  getVisitorCount: (...a: unknown[]) => getVisitorCountMock(...a),
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

// assertWithinCapacity throws a plain DomainError (location/domain.ts), NOT
// NonRetryableError — MemoryQueue retries anything that isn't a
// NonRetryableError up to maxAttempts (default 5, exponential backoff)
// before dead-lettering. What this file tests is "does the pre-commit
// check reject the check-in", not the queue's own retry/backoff mechanics
// (that's the queue package's own concern) — maxAttempts: 1 keeps delivery
// deterministic and fast without weakening the assertion: a rejected first
// attempt already proves nothing committed.
function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue({ maxAttempts: 1 });
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
  getVisitorCountMock.mockReset().mockResolvedValue(0);
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
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Visitor",
    visitorPhone: "9999999999", visitorCategory: "standard", identityDocRef: null,
  };
  // Real, tenant-scoped perimeter gate at the pass's own location — clears
  // the item-7 scope check trivially so it doesn't mask what this file tests.
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
  locationRow = { capacityThreshold: CAPACITY_THRESHOLD };
});

describe("checkInRecord capacity enforcement (post-#705-rebase regression)", () => {
  it("rejects (dead-letters) a check-in when occupancy is already AT the location's capacityThreshold", async () => {
    getVisitorCountMock.mockResolvedValue(CAPACITY_THRESHOLD); // occupancy === threshold => isOverCapacityThreshold => true (>=, not strictly >)

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID }, 60);

    expect(queue.dlq.length).toBeGreaterThan(0);
    // Asserts the SPECIFIC reason is capacity, not some unrelated failure —
    // this is what would go silently missing if the rebase's conflict
    // resolution dropped assertWithinCapacity's wiring.
    // location/domain.ts's DomainError stores `code` as a separate property
    // (not folded into `.message`, unlike some sibling DomainError classes
    // in this codebase — e.g. check-in/domain.ts's DOES prefix `[code]`),
    // and MemoryQueue's DLQ only records `err.message` — so match on
    // assertWithinCapacity's actual message text, which is still specific
    // enough to distinguish this from a scope/revocation/blacklist reject.
    expect(queue.dlq[0]?.error).toContain("location at capacity");
    expect(queue.dlq[0]?.msg.payload).toMatchObject({ passId: PASS_ID, gateId: GATE_ID });
  });

  it("rejects when occupancy is already OVER the location's capacityThreshold", async () => {
    getVisitorCountMock.mockResolvedValue(CAPACITY_THRESHOLD + 5);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID }, 60);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(queue.dlq[0]?.error).toContain("location at capacity"); // see comment above on why not "CAPACITY_EXCEEDED"
  });

  it("positive control: a check-in comfortably under threshold still commits normally", async () => {
    getVisitorCountMock.mockResolvedValue(CAPACITY_THRESHOLD - 10);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });

  it("a location with no capacityThreshold configured (null) never enforces capacity, no matter the occupancy", async () => {
    locationRow = { capacityThreshold: null };
    getVisitorCountMock.mockResolvedValue(999_999);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
  });
});
