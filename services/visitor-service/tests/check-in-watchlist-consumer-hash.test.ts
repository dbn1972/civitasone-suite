/**
 * check-in/consumer.ts's checkInRecord handler screens the just-checked-in
 * visitor against the watchlist.
 *
 * FIXED (as part of the compliance/print/analytics fix wave's Requirement 5
 * identity/blacklist check-in gate): consumer.ts previously populated
 * `identityDocHash: visit?.identityDocRef ?? null` (the visit request's
 * raw/decrypted identity-document reference — an `encryptedText()` column
 * that is transparently decrypted on read, per visit-request/schema.ts) and
 * handed that raw value straight to `isWatchlisted()`, naming the field
 * `identityDocHash` as though it already were one. `isWatchlisted`
 * (blacklist/screening-store.ts) SISMEMBERs against
 * `visitor:{tid}:watchlist:hashes`, a set populated exclusively with the
 * deterministic HMAC blind index produced by
 * `identityDocHash(docNumber, docType)` (blacklist/blind-index.ts) — the
 * SAME helper visit-request/routes.ts correctly calls for the synchronous
 * blacklist screen at submission time. A raw doc ref can never equal an HMAC
 * digest, so this screen could never fire a true positive no matter what was
 * on the watchlist. consumer.ts now computes
 * `identityDocHash(visit.identityDocRef, visit.identityDocType)` before
 * storing it, so the value handed to isWatchlisted() actually matches the
 * canonical hash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const isWatchlistedMock = vi.fn(async () => false);
// checkInRecord's identity/blacklist gate (fix #5) also checks isBlacklisted
// before the watchlist notification path runs; default not-blacklisted so
// these tests keep exercising the watchlist path specifically.
const isBlacklistedMock = vi.fn(async () => false);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";
// A real, matching watchlist entry would store this HMAC digest.
const RAW_IDENTITY_DOC_REF = "AADHAAR-9876-5432-1000";
const DOC_TYPE = "aadhaar";
const CORRECT_WATCHLIST_HASH = identityDocHash(RAW_IDENTITY_DOC_REF, DOC_TYPE);

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
// Unrelated fix (gate/location/area scope check, Property 26/19 — see
// check-in-bypasses-gate-scope.test.ts): checkInRecord now looks up `gates`
// right after loading the pass. A perimeter gate (areaId null) at the
// pass's own location always clears that check trivially, so it doesn't
// mask the (separate, not-yet-fixed-here) watchlist-hash bug this file
// documents — without this fixture, the check-in would dead-letter on the
// gate lookup before ever reaching the watchlist code this file tests.
let gateRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
    if (!fakeTx.__count) fakeTx.__count = 0;
    fakeTx.__count++;
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
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  isWatchlistedMock.mockReset().mockResolvedValue(false);
  isBlacklistedMock.mockReset().mockResolvedValue(false);
  fakeTx.select.mockClear();
  fakeTx.__count = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, locationId: LOCATION_ID, visitRequestId: VISIT_REQUEST_ID,
    status: "active", passType: "single",
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, hostEmployeeId: "host-1", visitorName: "Watchlisted Visitor",
    visitorPhone: "9999999999", visitorEmail: null, visitorCategory: "standard",
    identityDocRef: RAW_IDENTITY_DOC_REF, identityDocType: DOC_TYPE,
  };
  gateRow = { id: GATE_ID, tenantId: TENANT, locationId: LOCATION_ID, areaId: null };
});

describe("checkInRecord watchlist screening (fixed behavior)", () => {
  it("[FIXED] queries isWatchlisted with the blind-index hash, not the raw identityDocRef", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, CORRECT_WATCHLIST_HASH);
    expect(isWatchlistedMock).not.toHaveBeenCalledWith(TENANT, RAW_IDENTITY_DOC_REF);
  });

  it("[FIXED] correctly matches a real watchlist entry when the visitor's hash IS on the watchlist", async () => {
    // A real watchlist store answers `true` only for the correctly hashed
    // value — the mock here stands in for that store and proves the
    // consumer now sends it the value it needs to match on.
    isWatchlistedMock.mockImplementation(async (_tenant: string, hash: string) => hash === CORRECT_WATCHLIST_HASH);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, CORRECT_WATCHLIST_HASH);
    const result = await isWatchlistedMock.mock.results[isWatchlistedMock.mock.results.length - 1]?.value;
    expect(result).toBe(true);
  });
});

describe("what SHOULD happen", () => {
  it("[FIXED] isWatchlisted is queried with the same blind-index hash blacklist screening uses (identityDocHash(ref, type)), not the raw reference", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, CORRECT_WATCHLIST_HASH);
  });
});
