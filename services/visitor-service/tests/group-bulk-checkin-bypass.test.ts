/**
 * group-visit/consumer.ts's groupBulkCheckIn handler bypasses both
 * protections the single-visitor check-in path (check-in/consumer.ts)
 * enforces:
 *
 * 1. Evacuation roster (Requirement 17.1/17.2). check-in/consumer.ts's
 *    checkInRecord handler calls `addToRoster()` after every check-in
 *    (consumer.ts's own docstring cites this explicitly). group-visit's
 *    groupBulkCheckIn handler never imports evacuation/roster.ts at all —
 *    confirmed by reading the full consumer: its only imports are db,
 *    outbox, topics, its own schema, digital-pass schema/domain,
 *    visit-request schema, config-registry policy, and blacklist screening.
 *    A visitor who enters via a group bulk check-in is therefore invisible
 *    to the emergency evacuation headcount, even though they are physically
 *    inside.
 *
 * 2. Check-in state-machine validation. check-in/consumer.ts's checkInRecord
 *    handler loads the current pass row and runs it through
 *    `domainCheckIn()` (the active|issued|checked_out -> checked_in state
 *    machine) before transitioning it. group-visit's groupBulkCheckIn
 *    handler unconditionally does
 *    `tx.update(digitalPasses).set({ status: "checked_in", ... })` for every
 *    non-blacklisted member with a passId — it never reads the pass's
 *    current status/revoked flag first (only two selects ever happen in the
 *    handler: group_visits, then group_members — digital_passes is written,
 *    never read). A member whose individual pass was revoked after the
 *    group was created would be silently reactivated by the next bulk
 *    check-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRosterMock = vi.fn(async () => undefined);

const GROUP_VISIT_ID = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";

let groupRow: Record<string, unknown> | undefined;
let memberRows: Record<string, unknown>[] = [];
let selectCallIdx = 0;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => (Array.isArray(rows) ? rows : { limit: async () => rows }) }) };
}

// group-visit/consumer.ts's groupBulkCheckIn does `.select().from(groupVisits)
// .where(...).limit(1)` then `.select().from(groupMembers).where(...)` (no
// .limit on the second) — model both shapes so both awaits resolve correctly.
const fakeTx = {
  select: vi.fn(() => {
    selectCallIdx++;
    if (selectCallIdx === 1) {
      return { from: () => ({ where: () => ({ limit: async () => (groupRow ? [groupRow] : []) }) }) };
    }
    return { from: () => ({ where: async () => memberRows }) };
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
  fakeTx.select.mockClear();
  fakeTx.update.mockClear();
  selectCallIdx = 0;

  groupRow = { id: GROUP_VISIT_ID, tenantId: TENANT, groupName: "School Trip", memberCount: 2 };
  memberRows = [
    { id: "m-1", tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, passId: "pass-1", blacklisted: false, checkedIn: false },
    { id: "m-2", tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, passId: "pass-2", blacklisted: false, checkedIn: false },
  ];
});

const bulkCheckInPayload = { groupVisitId: GROUP_VISIT_ID, tenantId: TENANT, actualHeadcount: 2, gateId: "gate-1" };

describe("groupBulkCheckIn (today's actual behavior)", () => {
  it("never adds checked-in members to the evacuation roster", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    expect(fakeTx.update).toHaveBeenCalledTimes(4); // 2 members x (digitalPasses + groupMembers)
    expect(addToRosterMock).not.toHaveBeenCalled();
  });

  it("only ever reads group_visits and group_members — never checks a member's pass status/revoked flag before transitioning it to checked_in", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    expect(fakeTx.select).toHaveBeenCalledTimes(2);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("members checked in via group bulk check-in appear on the evacuation roster", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    expect(addToRosterMock).toHaveBeenCalledTimes(2);
  });

  it.fails("a member's pass status/revoked flag is checked before it is force-transitioned to checked_in (so an individually-revoked pass cannot be silently reactivated)", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.groupBulkCheckIn, bulkCheckInPayload);

    expect(fakeTx.select.mock.calls.length).toBeGreaterThan(2);
  });
});
