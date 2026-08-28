/**
 * FIXED — group-visit/consumer.ts's groupBulkCheckIn handler used to bypass
 * both protections the single-visitor check-in path (check-in/consumer.ts)
 * enforces:
 *
 * 1. Evacuation roster (Requirement 17.1/17.2). check-in/consumer.ts's
 *    checkInRecord handler calls `addToRoster()` after every check-in
 *    (consumer.ts's own docstring cites this explicitly). group-visit's
 *    groupBulkCheckIn handler never imported evacuation/roster.ts at all, so
 *    a visitor who entered via a group bulk check-in was invisible to the
 *    emergency evacuation headcount, even though they were physically inside.
 *
 * 2. Check-in state-machine validation. check-in/consumer.ts's checkInRecord
 *    handler loads the current pass row and runs it through
 *    `domainCheckIn()` (the active|issued|checked_out -> checked_in state
 *    machine) before transitioning it. group-visit's groupBulkCheckIn
 *    handler used to unconditionally do
 *    `tx.update(digitalPasses).set({ status: "checked_in", ... })` for every
 *    non-blacklisted member with a passId — it never read the pass's current
 *    status first. A member whose individual pass was revoked after the
 *    group was created would have been silently reactivated by the next
 *    bulk check-in.
 *
 * FIXED: groupBulkCheckIn now bulk-reads every member's digital_passes row
 * (one extra query, not per-member), runs each through the same
 * domainCheckIn() state machine as the single check-in path (skipping —
 * not silently reactivating — a member whose pass isn't in a checkinable
 * state), inserts a check_ins audit row per member, and — post-commit,
 * same as check-in/consumer.ts — adds every successfully checked-in member
 * to the evacuation roster and runs the capacity-threshold check. See
 * tests/group-checkin-evacuation-roster-gap.integration.test.ts for the
 * same fix proven end-to-end against the real DB/Redis.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRosterMock = vi.fn(async () => undefined);
const getVisitorCountMock = vi.fn(async () => 0);

const GROUP_VISIT_ID = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "55555555-5555-5555-5555-555555555555";

let groupRow: Record<string, unknown> | undefined;
let memberRows: Record<string, unknown>[] = [];
// BUG FIX fixture: the digital_passes rows groupBulkCheckIn now reads
// before writing (previously it never read this table at all).
let passRows: Record<string, unknown>[] = [];
// BUG FIX fixture: the locations row groupBulkCheckIn now reads post-write
// to resolve capacityThreshold, same as check-in/consumer.ts.
let locationRow: Record<string, unknown> | undefined;
let selectCallIdx = 0;

// group-visit/consumer.ts's groupBulkCheckIn does, in order:
//   1. .select().from(groupVisits).where(...).limit(1)
//   2. .select().from(groupMembers).where(...)                    (no .limit)
//   3. .select().from(digitalPasses).where(...)  [BUG FIX: new]    (no .limit)
//   4. .select({...}).from(locations).where(...).limit(1)  [BUG FIX: new]
// Model all four shapes so every await resolves correctly.
const fakeTx = {
  select: vi.fn(() => {
    selectCallIdx++;
    if (selectCallIdx === 1) {
      return { from: () => ({ where: () => ({ limit: async () => (groupRow ? [groupRow] : []) }) }) };
    }
    if (selectCallIdx === 2) {
      return { from: () => ({ where: async () => memberRows }) };
    }
    if (selectCallIdx === 3) {
      return { from: () => ({ where: async () => passRows }) };
    }
    return { from: () => ({ where: () => ({ limit: async () => (locationRow ? [locationRow] : []) }) }) };
  }),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: (...args: unknown[]) => addToRosterMock(...args),
  removeFromRoster: vi.fn(async () => undefined),
  getVisitorCount: (...args: unknown[]) => getVisitorCountMock(...args),
}));

process.env.VISITOR_QR_PRIVATE_KEY ??= "test-qr-private-key";

const { registerGroupVisitConsumers } = await import("../src/modules/group-visit/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerGroupVisitConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, { type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0", payload });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  addToRosterMock.mockReset().mockResolvedValue(undefined);
  getVisitorCountMock.mockReset().mockResolvedValue(0);
  fakeTx.select.mockClear();
  fakeTx.update.mockClear();
  selectCallIdx = 0;

  groupRow = { id: GROUP_VISIT_ID, tenantId: TENANT, groupName: "School Trip", memberCount: 2 };
  memberRows = [
    { id: "m-1", tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, memberName: "Member One", passId: "pass-1", blacklisted: false, checkedIn: false },
    { id: "m-2", tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, memberName: "Member Two", passId: "pass-2", blacklisted: false, checkedIn: false },
  ];
  // Both members' passes are in a normal checkinable state by default.
  passRows = [
    { id: "pass-1", tenantId: TENANT, locationId: LOCATION_ID, status: "active", passType: "single" },
    { id: "pass-2", tenantId: TENANT, locationId: LOCATION_ID, status: "active", passType: "single" },
  ];
  // No capacity configured by default — keeps the capacity-check branch a
  // no-op in tests that don't care about it (isolated capacity behavior is
  // covered live in group-checkin-evacuation-roster-gap.integration.test.ts).
  locationRow = { capacityThreshold: null };
});

const bulkCheckInPayload = { groupVisitId: GROUP_VISIT_ID, tenantId: TENANT, actualHeadcount: 2, gateId: "gate-1" };

describe("groupBulkCheckIn (FIXED)", () => {
  it("adds both checked-in members to the evacuation roster", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    expect(fakeTx.update).toHaveBeenCalledTimes(4); // 2 members x (digitalPasses + groupMembers)
    expect(addToRosterMock).toHaveBeenCalledTimes(2);
  });

  it("reads group_visits, group_members, AND each member's digital_passes row before transitioning any of them to checked_in", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    // group_visits + group_members + digital_passes (+ locations for the
    // capacity check) — strictly more reads than the original 2-select bug.
    expect(fakeTx.select.mock.calls.length).toBeGreaterThan(2);
  });

  it("does NOT reactivate a member whose pass is not in a checkinable state (e.g. revoked) — skips it instead", async () => {
    passRows = [
      { id: "pass-1", tenantId: TENANT, locationId: LOCATION_ID, status: "revoked", passType: "single" },
      { id: "pass-2", tenantId: TENANT, locationId: LOCATION_ID, status: "active", passType: "single" },
    ];
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    // Only pass-2 (active) is transitioned: 1 member x (digitalPasses + groupMembers) = 2 updates.
    expect(fakeTx.update).toHaveBeenCalledTimes(2);
    // Only the successfully checked-in member reaches the roster.
    expect(addToRosterMock).toHaveBeenCalledTimes(1);
    expect(addToRosterMock).toHaveBeenCalledWith(
      TENANT,
      LOCATION_ID,
      expect.objectContaining({ passId: "pass-2" }),
    );
  });
});
