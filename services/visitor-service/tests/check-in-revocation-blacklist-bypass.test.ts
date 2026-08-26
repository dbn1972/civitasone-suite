/**
 * HIGH (FIXED) — checkInRecord's commit path never checked revocation or
 * blacklist status, even after item 7's gate/location/area scope fix.
 *
 * POST /v1/visitor/passes/verify (check-in/routes.ts) enforces Property 9
 * condition (b) isRevoked and condition (e) isBlacklisted before ever
 * calling anything "valid" — but check-in/consumer.ts's checkInRecord,
 * which is what actually COMMITS the check-in, referenced neither
 * isRevoked, isBlacklisted, nor pass.revoked at all.
 *
 * digital-pass/consumer.ts's passRevoke handler dual-writes
 * digitalPasses.status = "revoked" for a DIRECTLY-revoked pass, which
 * domainCheckIn's state machine already happens to reject via
 * INVALID_TRANSITION — but recurring-pass/consumer.ts's suspend/revoke
 * handlers never touch digitalPasses.status at all; they only add the pass
 * ID to the SAME Redis revocation set isRevoked() reads (commit 25949e30,
 * "recurring-pass revocation now blocks at the gate") — a write that only
 * matters if something at commit time reads it, and until this fix nothing
 * did.
 *
 * ORIGINAL BUG: POST /v1/visitor/check-ins (check-in/routes.ts) publishes
 * checkInRecord straight from {passId, gateId} with no precondition that
 * /passes/verify was ever called, reachable by the broad "employee" role
 * (check-in/routes.ts's WRITE_ROLES) — so an employee-role caller who knew
 * a passId+gateId could check in a revoked or blacklisted pass by hitting
 * this endpoint directly, skipping verify entirely.
 *
 * FIXED (revocation): checkInRecord now calls isRevoked(tenantId, passId)
 * immediately after the gate/location/area scope re-assertion (item 7) and
 * before any write, throwing NonRetryableError on a hit — dead-lettered,
 * the same convention item 7 established for this exact commit path.
 *
 * FIXED (blacklist — landed independently): while this branch was in
 * flight, PR #706 (merged to main, then reconciled into this branch via
 * rebase) independently added its own identity-verification/blacklist gate
 * to this same function — see check-in/consumer.ts's "Identity-verification
 * / blacklist gate" comment block and its dedicated coverage in
 * tests/check-in-identity-blacklist-gate.test.ts. It calls
 * isBlacklisted(tenantId, identityDocHash(ref, type)) — the SAME blind-index
 * hash /passes/verify's caller and visit-request/routes.ts's synchronous
 * screen both use, never the raw decrypted reference. This branch's own
 * (near-identical) blacklist check was dropped during reconciliation to
 * avoid double-querying isBlacklisted for the same thing; the blacklist
 * tests below now exercise #706's gate and remain here to confirm the
 * revocation and blacklist checks compose correctly at the SAME commit
 * path after the merge (e.g. revocation short-circuits before the
 * blacklist gate even runs), not to claim ownership of the blacklist logic
 * itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";

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
// A real blacklist entry would store this HMAC digest, never the raw ref.
const RAW_IDENTITY_DOC_REF = "AADHAAR-1234-5678-9999";
const DOC_TYPE = "aadhaar";
const CORRECT_HASH = identityDocHash(RAW_IDENTITY_DOC_REF, DOC_TYPE);

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
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Visitor",
    visitorPhone: "9999999999", visitorCategory: "standard",
    identityDocRef: RAW_IDENTITY_DOC_REF, identityDocType: DOC_TYPE,
  };
  // Real, tenant-scoped perimeter gate at the pass's own location — clears
  // the item-7 scope check trivially so it doesn't mask what this file tests.
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
});

describe("checkInRecord revocation check (FIXED)", () => {
  it("rejects (dead-letters) a check-in for a pass in the Redis revocation set — e.g. a suspended/revoked recurring pass whose digitalPasses.status was never touched — without ever reaching digitalPasses/checkIns writes", async () => {
    isRevokedMock.mockResolvedValue(true);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(queue.dlq[0]?.error).toContain("revoked");
    expect(isRevokedMock).toHaveBeenCalledWith(TENANT, PASS_ID);
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("short-circuits before the blacklist check (and before the visitRequests lookup) once revocation already rejected", async () => {
    isRevokedMock.mockResolvedValue(true);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID }, 600);

    expect(isBlacklistedMock).not.toHaveBeenCalled();
    // Only digitalPasses + gates were queried — visitRequests (call #3)
    // never reached.
    expect(fakeTx.select).toHaveBeenCalledTimes(2);
  });
});

describe("checkInRecord blacklist check (from #706, confirmed intact after reconciliation)", () => {
  it("rejects (dead-letters) a check-in whose visitor's identity document is on the blacklist — screened via the blind-index hash, not the raw reference", async () => {
    isBlacklistedMock.mockImplementation(async (_tenant: string, hash: string) => hash === CORRECT_HASH);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
    expect(queue.dlq[0]?.error).toContain("blacklisted");
    expect(isBlacklistedMock).toHaveBeenCalledWith(TENANT, CORRECT_HASH);
    // Never the raw reference straight through — the exact mistake
    // tests/check-in-watchlist-consumer-hash.test.ts documents the
    // separate post-commit isWatchlisted() call once also made (fixed by
    // #706 too, alongside this pre-commit blacklist gate).
    expect(isBlacklistedMock).not.toHaveBeenCalledWith(TENANT, RAW_IDENTITY_DOC_REF);
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("skips the blacklist check entirely when the visit captured no identity document reference — nothing to screen against", async () => {
    visitRow = { ...visitRow, identityDocRef: null };
    isBlacklistedMock.mockResolvedValue(true); // would wrongly reject if called with anything at all

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isBlacklistedMock).not.toHaveBeenCalled();
    expect(queue.dlq).toHaveLength(0);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
  });

  it("positive control: neither revoked nor blacklisted still commits the check-in normally", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(queue.dlq).toHaveLength(0);
    expect(isRevokedMock).toHaveBeenCalledWith(TENANT, PASS_ID);
    expect(isBlacklistedMock).toHaveBeenCalledWith(TENANT, CORRECT_HASH);
    expect(fakeTx.update).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
  });
});
