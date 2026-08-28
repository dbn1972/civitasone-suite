/**
 * MEDIUM-HIGH (FIXED) — the check-in commit path used to enforce none of the
 * scope checks the synchronous verify endpoint performs.
 *
 * POST /v1/visitor/passes/verify (check-in/routes.ts) runs QR
 * signature/claims verification, a revocation-set check, Property 26
 * (`isLocationScopeValid` — the pass's location_id must match the gate's
 * location) and Property 19 (`isAreaPermitted` — a zone-boundary gate's area
 * must be in the pass's permitted_areas) before it will call anything
 * "valid".
 *
 * ORIGINAL BUG: the command that actually MUTATES state —
 * `COMMANDS.checkInRecord`, handled by check-in/consumer.ts — took a bare
 * `{ passId, gateId }` and did none of this: it loaded the pass by
 * `(passId, tenantId)` only, ran it through `domainCheckIn()` (status
 * machine only), and committed. It never looked up `gateId` in the `gates`
 * table, never compared the gate's location/area to the pass's
 * `locationId`/`permittedAreas`. `POST /v1/visitor/check-ins` is reachable
 * by the broad "employee" role (check-in/routes.ts's WRITE_ROLES), not only
 * a `gate_terminal` device identity, so a caller could check in any pass at
 * any gate string, including a gateId that did not correspond to any real
 * gate row at all.
 *
 * FIXED: the handler now looks up `gateId` in `gates` (tenant-scoped) right
 * after loading the pass, and — before doing anything else — re-asserts
 * Property 26 (`isLocationScopeValid`) and Property 19 (`isAreaPermitted`)
 * using the exact same domain.ts functions the verify endpoint uses. Any
 * failure (gate not found, wrong location, wrong area) throws
 * `NonRetryableError` — dead-lettered, matching this codebase's convention
 * (see config-registry/consumer.ts) — before the transaction ever reaches
 * the `checkIns` insert or the `digitalPasses` status update. (checkInRecord's
 * payload carries no QR token to re-verify a signature against — that
 * already happened at /passes/verify; scope re-assertion is the part of
 * Property 9 this write path can and now does perform.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
// The pass is scoped to this location/areas...
const PASS_LOCATION_ID = "44444444-4444-4444-4444-444444444444";
// ...but the check-in is recorded against a gateId with no relationship to
// any gate row, any location, or the pass's permitted areas whatsoever.
const UNRELATED_GATE_ID = "99999999-9999-9999-9999-999999999999";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";
// A real, tenant-scoped gate row used by the Property 26/19 and
// positive-control cases below (unlike UNRELATED_GATE_ID, this ALWAYS
// resolves to a `gateRow` — its location/area is varied per test).
const REAL_GATE_ID = "88888888-8888-8888-8888-888888888888";
const OTHER_LOCATION_ID = "55555555-5555-5555-5555-555555555555";

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
let gateRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn((...args: unknown[]) => {
    void args;
    if (!fakeTx.__count) fakeTx.__count = 0;
    fakeTx.__count++;
    // Call sequence inside checkInRecord's handler, in order (FIXED adds #2):
    //   1. digitalPasses (the pass)
    //   2. gates            — NEW: gate/location/area scope check
    //   3. visitRequests    (host lookup, for the arrival notification)
    //   4. locations        (capacityThreshold lookup)
    // A scope-check failure (no gate, wrong location, wrong area) throws
    // right after call 2 — calls 3/4 are never reached in that case.
    if (fakeTx.__count === 1) return makeChain(passRow ? [passRow] : []);
    if (fakeTx.__count === 2) return makeChain(gateRow ? [gateRow] : []);
    if (fakeTx.__count === 3) return makeChain(visitRow ? [visitRow] : []);
    return makeChain([]); // locations — capacityThreshold not exercised here
  }) as unknown as (() => ReturnType<typeof makeChain>) & { __count?: number },
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: vi.fn(async () => undefined),
  removeFromRoster: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => false,
}));

vi.mock("../src/modules/blacklist/screening-store.js", () => ({
  isWatchlisted: async () => false,
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
  fakeTx.select.mockClear();
  fakeTx.update.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.__count = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, locationId: PASS_LOCATION_ID, visitRequestId: VISIT_REQUEST_ID,
    status: "active", passType: "single", permittedAreas: ["area-in-a-totally-different-wing"],
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Visitor",
    visitorPhone: "9999999999", visitorEmail: null, visitorCategory: "standard", identityDocRef: null,
  };
  // No gate resolves by default (mirrors UNRELATED_GATE_ID) — tests that
  // need a real gate set this explicitly.
  gateRow = undefined;
});

describe("checkInRecord gate/location scoping (FIXED)", () => {
  it("rejects (dead-letters) a check-in whose gateId matches no real gate, no real location, and none of the pass's permitted areas — never touches digitalPasses or checkIns", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("now queries the gates table before committing anything, and fails closed before ever reaching visitRequests/locations", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID }, 600);

    // digitalPasses (the pass), then gates (which resolves to no rows) —
    // the throw happens immediately after, before visitRequests/locations
    // are ever reached. Contrast with the pre-fix behavior, which queried
    // exactly 3 tables and never touched `gates` at all.
    expect(fakeTx.select).toHaveBeenCalledTimes(2);
  });

  it("rejects a check-in at a real gate whose location does not match the pass's location (Property 26)", async () => {
    gateRow = { id: REAL_GATE_ID, tenantId: TENANT, locationId: OTHER_LOCATION_ID, areaId: null };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: REAL_GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("rejects a check-in at a real, correctly-located gate whose area is not among the pass's permitted areas (Property 19)", async () => {
    gateRow = { id: REAL_GATE_ID, tenantId: TENANT, locationId: PASS_LOCATION_ID, areaId: "a-zone-the-pass-does-not-permit" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: REAL_GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("positive control: a real perimeter gate (areaId null) matching the pass's location still commits the check-in normally", async () => {
    gateRow = { id: REAL_GATE_ID, tenantId: TENANT, locationId: PASS_LOCATION_ID, areaId: null };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: REAL_GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });

  it("positive control: a real gate whose area IS among the pass's permitted areas still commits the check-in normally", async () => {
    gateRow = { id: REAL_GATE_ID, tenantId: TENANT, locationId: PASS_LOCATION_ID, areaId: "area-in-a-totally-different-wing" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: REAL_GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("a check-in is rejected when gateId does not resolve to a real, tenant-scoped gate", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});
