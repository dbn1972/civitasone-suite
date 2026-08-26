/**
 * check-in/consumer.ts's checkInRecord identity/blacklist gate (compliance/
 * print/analytics fix wave, fix 5) — behavioral coverage.
 *
 * Before this fix, checkInRecord never inspected the visit's own identity-
 * verification outcome or blacklist status: a failed DigiLocker/Aadhaar
 * verification, or a blacklisted identity document, only ever produced an
 * event for a human to notice later — nothing stopped the actual check-in.
 * The gate (consumer.ts:155-172) now throws NonRetryableError — which
 * MemoryQueue's deliver() routes straight to the DLQ without retry
 * (queue-service/src/bus.ts) — BEFORE any check-in side effect (checkIns
 * insert, digitalPasses status transition, visitorCheckedIn outbox event,
 * host notification) is written, for two independent conditions:
 *
 *   1. identityMethod is a REAL verification method ("digilocker" /
 *      "aadhaar_face") AND identityVerified is still false — i.e. a
 *      verification was attempted and did not succeed. See
 *      identity/consumer.ts: this is exactly the identityMethod/
 *      identityVerified combination it writes on a genuine verification
 *      failure (identityMethod was previously left untouched on failure,
 *      so "attempted and failed" and "never attempted" were
 *      indistinguishable — both read identityMethod: null).
 *   2. The visit's own identityDocRef hashes (identityDocHash — the
 *      canonical, doc-type-folded blind index) to a value on the tenant's
 *      blacklist set — independent of whether a document-scan happened
 *      for this visit.
 *
 * Deliberately NOT blocked: identityMethod null (verification never
 * required/attempted for this visit — the common case) and identityMethod
 * "manual" (identity/consumer.ts's sanctioned circuit-open/service-
 * unavailable fallback — the guard verifies physically; blocking this
 * would break the degraded-mode path instead of enforcing anything).
 *
 * Mocking approach mirrors the existing sibling suites for this consumer
 * (check-in-consumer.test.ts, check-in-watchlist-consumer-hash.test.ts):
 * db/outbox/roster/policy/screening-store are mocked so these are fast,
 * deterministic unit tests of the gate's decision logic itself, using
 * `new MemoryQueue()` directly (no real DB/Redis/RLS involved).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const isWatchlistedMock = vi.fn(async () => false);
const isBlacklistedMock = vi.fn(async () => false);

const TENANT = "aaaaaaaa-1111-1111-1111-111111111111";
const ACTOR = "aaaaaaaa-2222-2222-2222-222222222222";
const PASS_ID = "aaaaaaaa-3333-3333-3333-333333333333";
const LOCATION_ID = "aaaaaaaa-4444-4444-4444-444444444444";
const GATE_ID = "aaaaaaaa-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "aaaaaaaa-6666-6666-6666-666666666666";

const DOC_TYPE = "aadhaar";
const CLEAN_DOC_REF = "AADHAAR-GATE-TEST-CLEAN-0001";
const BLACKLISTED_DOC_REF = "AADHAAR-GATE-TEST-BLACKLISTED-0002";
const BLACKLISTED_HASH = identityDocHash(BLACKLISTED_DOC_REF, DOC_TYPE);

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
// Reconciliation note (post-rebase): checkInRecord now ALSO looks up `gates`
// (Property 26/19 gate/location/area scope re-assertion — see
// check-in-bypasses-gate-scope.test.ts) right after loading the pass, before
// the identity-verification/blacklist gate this file tests. A real,
// tenant-scoped perimeter gate (areaId null) at the pass's own location
// clears that check trivially, so it doesn't mask what this file tests —
// without it, every check-in below would dead-letter on the gate lookup
// before ever reaching the identity/blacklist gate.
let gateRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
    if (!fakeTx.__count) fakeTx.__count = 0;
    fakeTx.__count++;
    // consumer.ts's actual query order: digitalPasses, then gates (scope
    // check), then visitRequests (the identity/blacklist gate runs
    // immediately after, before any further select).
    if (fakeTx.__count === 1) return makeChain(passRow ? [passRow] : []);
    if (fakeTx.__count === 2) return makeChain(gateRow ? [gateRow] : []);
    return makeChain(visitRow ? [visitRow] : []);
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
  isWatchlisted: (...args: unknown[]) => isWatchlistedMock(...args),
  isBlacklisted: (...args: unknown[]) => isBlacklistedMock(...args),
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
  // MemoryQueue delivers via setTimeout(0); flush the microtask/macrotask queue.
  await new Promise((r) => setTimeout(r, waitMs));
}

/** Realistic visit_requests row shape, matching visit-request/schema.ts. */
function baseVisitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1",
    visitorName: "Gate Test Visitor", visitorPhone: "9999999999",
    visitorEmail: null, visitorCategory: "standard",
    identityDocRef: CLEAN_DOC_REF, identityDocType: DOC_TYPE,
    // Default: verification never attempted for this visit (the common case).
    identityMethod: null, identityVerified: false,
    ...overrides,
  };
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  isWatchlistedMock.mockReset().mockResolvedValue(false);
  isBlacklistedMock.mockReset().mockResolvedValue(false);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  fakeTx.__count = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, locationId: LOCATION_ID, visitRequestId: VISIT_REQUEST_ID,
    status: "active", passType: "single", permittedAreas: [],
  };
  visitRow = baseVisitRow();
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
});

describe("checkInRecord identity-verification gate", () => {
  it("blocks check-in when identityMethod is 'digilocker' and identityVerified is false (attempted and failed)", async () => {
    visitRow = baseVisitRow({ identityMethod: "digilocker", identityVerified: false });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]!.error).toContain("failed identity verification");
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("blocks check-in when identityMethod is 'aadhaar_face' and identityVerified is false (attempted and failed)", async () => {
    visitRow = baseVisitRow({ identityMethod: "aadhaar_face", identityVerified: false });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]!.error).toContain("failed identity verification");
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("allows check-in when identityMethod is null (verification never attempted for this visit)", async () => {
    visitRow = baseVisitRow({ identityMethod: null, identityVerified: false });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.insert).toHaveBeenCalled();
  });

  it("allows check-in when identityMethod is 'manual' (service-unavailable degraded fallback, not a failure)", async () => {
    visitRow = baseVisitRow({ identityMethod: "manual", identityVerified: false });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.insert).toHaveBeenCalled();
  });

  it("allows check-in when identityMethod is set and identityVerified is true", async () => {
    visitRow = baseVisitRow({ identityMethod: "digilocker", identityVerified: true });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.insert).toHaveBeenCalled();
  });
});

describe("checkInRecord blacklist-hash gate", () => {
  it("blocks check-in when the visit's own identity document hash is on the blacklist", async () => {
    isBlacklistedMock.mockImplementation(async (_tenant: string, hash: string) => hash === BLACKLISTED_HASH);
    visitRow = baseVisitRow({ identityDocRef: BLACKLISTED_DOC_REF, identityDocType: DOC_TYPE });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isBlacklistedMock).toHaveBeenCalledWith(TENANT, BLACKLISTED_HASH);
    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]!.error).toContain("identity document is blacklisted");
    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("allows check-in when the visit's identity document hash is NOT on the blacklist", async () => {
    isBlacklistedMock.mockResolvedValue(false);
    visitRow = baseVisitRow({ identityDocRef: CLEAN_DOC_REF, identityDocType: DOC_TYPE });
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isBlacklistedMock).toHaveBeenCalledWith(TENANT, identityDocHash(CLEAN_DOC_REF, DOC_TYPE));
    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.insert).toHaveBeenCalled();
  });
});
