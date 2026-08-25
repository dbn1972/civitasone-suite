/**
 * check-in/consumer.ts's checkInRecord handler screens the just-checked-in
 * visitor against the watchlist using the WRONG value.
 *
 * consumer.ts populates `identityDocHash: visit?.identityDocRef ?? null`
 * (the visit request's raw/decrypted identity-document reference — an
 * `encryptedText()` column that is transparently decrypted on read, per
 * visit-request/schema.ts) and later calls
 * `isWatchlisted(msg.tenantId, committed.identityDocHash)`.
 *
 * `isWatchlisted` (blacklist/screening-store.ts) SISMEMBERs against
 * `visitor:{tid}:watchlist:hashes`, a set of deterministic HMAC blind-index
 * hashes produced by `identityDocHash()` (blacklist/blind-index.ts) — the
 * SAME helper visit-request/routes.ts correctly calls for the synchronous
 * blacklist screen at submission time. check-in/consumer.ts never calls this
 * helper; it passes the raw document reference straight through. A raw doc
 * ref will never equal an HMAC digest, so this screen can never fire a true
 * positive no matter what is on the watchlist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const isWatchlistedMock = vi.fn(async () => false);

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

function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
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
  isWatchlisted: (...args: unknown[]) => isWatchlistedMock(...args),
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
});

describe("checkInRecord watchlist screening (today's actual behavior)", () => {
  it("queries isWatchlisted with the raw identityDocRef, not its blind-index hash", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, RAW_IDENTITY_DOC_REF);
  });

  it("never matches a real watchlist entry even when the visitor's hash IS on the watchlist", async () => {
    // A real watchlist store would answer `true` only for the correctly
    // hashed value — the mock here stands in for that store and proves the
    // consumer never sends it the value it would need to match on.
    isWatchlistedMock.mockImplementation(async (_tenant: string, hash: string) => hash === CORRECT_WATCHLIST_HASH);

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, RAW_IDENTITY_DOC_REF);
    const result = await isWatchlistedMock.mock.results[isWatchlistedMock.mock.results.length - 1]?.value;
    expect(result).toBe(false);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("isWatchlisted is queried with the same blind-index hash blacklist screening uses (identityDocHash(ref, type)), not the raw reference", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(isWatchlistedMock).toHaveBeenCalledWith(TENANT, CORRECT_WATCHLIST_HASH);
  });
});
