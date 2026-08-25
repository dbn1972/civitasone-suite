/**
 * MEDIUM-HIGH — the actual check-in commit path enforces none of the scope
 * checks the synchronous verify endpoint performs.
 *
 * POST /v1/visitor/passes/verify (check-in/routes.ts) runs QR
 * signature/claims verification, a revocation-set check, Property 26
 * (`isLocationScopeValid` — the pass's location_id must match the gate's
 * location) and Property 19 (`isAreaPermitted` — a zone-boundary gate's area
 * must be in the pass's permitted_areas) before it will call anything
 * "valid".
 *
 * But the command that actually MUTATES state — `COMMANDS.checkInRecord`,
 * handled by check-in/consumer.ts — takes a bare `{ passId, gateId }` and
 * does none of this: it loads the pass by `(passId, tenantId)` only, runs it
 * through `domainCheckIn()` (status machine only), and commits. It never
 * looks up `gateId` in the `gates` table, never compares the gate's
 * location/area to the pass's `locationId`/`permittedAreas`, and never
 * checks QR signature or revocation. Nothing links a prior successful
 * `/passes/verify` call to the subsequent `/check-ins` write — they are
 * fully decoupled — and `POST /v1/visitor/check-ins` is reachable by the
 * broad "employee" role (check-in/routes.ts's WRITE_ROLES), not only a
 * `gate_terminal` device identity. A caller can check in any pass at any
 * gate string, including a gateId that does not correspond to any real gate
 * row at all.
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

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn((...args: unknown[]) => {
    void args;
    if (!fakeTx.__count) fakeTx.__count = 0;
    fakeTx.__count++;
    return fakeTx.__count % 2 === 1 ? makeChain(passRow ? [passRow] : []) : makeChain(visitRow ? [visitRow] : []);
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
  fakeTx.__count = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, locationId: PASS_LOCATION_ID, visitRequestId: VISIT_REQUEST_ID,
    status: "active", passType: "single", permittedAreas: ["area-in-a-totally-different-wing"],
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Visitor",
    visitorPhone: "9999999999", visitorEmail: null, visitorCategory: "standard", identityDocRef: null,
  };
});

describe("checkInRecord gate/location scoping (today's actual behavior)", () => {
  it("commits a check-in for a gateId that matches no real gate, no real location, and none of the pass's permitted areas", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    // digitalPasses status update + checkIns insert both went through.
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });

  it("never queries the gates table to resolve gateId's location/area at all", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID });

    // The handler selects digitalPasses, then visitRequests, then locations
    // (to read capacityThreshold) — three calls, all captured by the
    // odd/even dispatch above (the 3rd call falls through to the
    // visitRow-shaped branch, which has no capacityThreshold field, so the
    // capacity-alert path resolves to null/skipped). `gates` is never among
    // them — nothing in this handler ever resolves gateId to a real gate
    // row, let alone compares its location/area to the pass.
    expect(fakeTx.select).toHaveBeenCalledTimes(3);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("a check-in is rejected when gateId does not resolve to a real, tenant-scoped gate", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: UNRELATED_GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});
