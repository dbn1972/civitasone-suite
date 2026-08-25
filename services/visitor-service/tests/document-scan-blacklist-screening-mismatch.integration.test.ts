/**
 * CROSS-MODULE INTEGRATION FINDING (CRITICAL) — document-scan's
 * blacklist/watchlist screening is broken by THREE independent, stacked
 * bugs, so a blacklisted person's ID document is never flagged at the
 * kiosk scanner, and even a hypothetical flag would reach no one.
 *
 * `modules/document-scan/consumer.ts`'s `scanProcess` handler screens the
 * scanned document against Redis using ITS OWN, locally-defined key
 * builders and hash call:
 *
 *   function blacklistKey(tenantId) { return `visitor:${tenantId}:blacklist:docs`; }
 *   function watchlistKey(tenantId) { return `visitor:${tenantId}:watchlist:docs`; }
 *   ...
 *   const docHash = blindIndex(mapped.idDocumentNumber!);           // consumer.ts:214
 *   redis.sismember(blacklistKey(tenantId), docHash)
 *   redis.sismember(watchlistKey(tenantId), docHash)
 *
 * BUG 1 (wrong Redis key): the ONLY writers of blacklist/watchlist
 * screening sets anywhere in this service are
 * `modules/blacklist/screening-store.ts#addToBlacklistHashSet` /
 * `addToWatchlistHashSet` (called from `modules/blacklist/consumer.ts`'s
 * `blacklistApprove`/`watchlistAdd` handlers), and they write to
 * `visitor:{tid}:blacklist:hashes` / `visitor:{tid}:watchlist:hashes` —
 * note `:hashes`, not document-scan's `:docs`. document-scan's sets are
 * two entirely different, permanently empty Redis keys.
 *
 * BUG 2 (wrong hash, independent of BUG 1): even if the key names matched,
 * `modules/blacklist/blind-index.ts#identityDocHash(docNumber, docType)` —
 * the ONLY function that ever produces a hash landing in the real
 * blacklist/watchlist sets — folds the document TYPE into the hashed
 * value (`blindIndex(`${type}:${docNumber}`)`) specifically so cross-type
 * collisions are impossible. document-scan calls the bare primitive,
 * `blindIndex(mapped.idDocumentNumber!)`, with no type prefix at all. The
 * two hashes for the SAME document number are simply different strings.
 *
 * BUG 3 (makes even a correct match moot): `EVENTS.scanBlacklistMatch` IS
 * published when `blacklistMatch` is true (consumer.ts:291-304), but a
 * repo-wide scan of every module's consumer.ts shows nothing ever calls
 * `queue.subscribe()` on it — it is enqueued into the void. Nothing else
 * in the codebase reads `ocr_results.blacklistMatch` / `watchlistMatch`
 * either (no route, no check-in gate) — see the second `describe` block
 * below.
 *
 * Net effect: scanning a blacklisted/watchlisted person's ID at a kiosk
 * can never result in a block, a review flag, or even a log line anyone
 * will see — the screening this module's own docstring describes
 * ("blacklist/watchlist screening (Requirement 6.10)") does not function.
 *
 * This test overrides the suite-wide `CACHE_DRIVER=memory` default for
 * THIS FILE ONLY (dynamic-imports the consumer + policy-sensitive modules
 * AFTER the override, exactly as static ESM imports are hoisted before any
 * top-level code can run) so both the canonical screening-store add-path
 * and document-scan's own screening code talk to the SAME real Redis
 * instance — proving a genuine key/hash mismatch, not merely "Redis is
 * unconfigured".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { db, scopedRead } from "../src/shared/db.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { locations } from "../src/modules/location/schema.js";
import { scanSessions, ocrResults } from "../src/modules/document-scan/schema.js";
import { addToBlacklistHashSet, isBlacklisted } from "../src/modules/blacklist/screening-store.js";
import { identityDocHash, blindIndex } from "../src/modules/blacklist/blind-index.js";
import { COMMANDS } from "../src/topics.js";

// Override the suite-wide memory default for this file only — see file
// docstring. Both `getRedis()` (document-scan/consumer.ts) and
// `getStore()` (blacklist/screening-store.ts) read these lazily at call
// time, so mutating process.env here (before anything calls them) is
// sufficient; no need to touch the other test files' shared default.
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
process.env.CACHE_DRIVER = "redis";
process.env.S3_BUCKET = process.env.S3_BUCKET ?? "audit-test-bucket";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const ACTOR = randomUUID();
const DEVICE_ID = randomUUID();
const SESSION_ID = randomUUID();

const RAW_DOC_NUMBER = "934821005566"; // 12 digits -> real detectDocumentType() calls this "aadhaar"
const DOC_TYPE = "aadhaar";

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

// What the CORRECT/canonical add-path stores (identityDocHash folds in doc type).
const CANONICAL_HASH = identityDocHash(RAW_DOC_NUMBER, DOC_TYPE);
// What document-scan/consumer.ts actually computes for the SAME document (bare blindIndex).
const SCAN_TIME_HASH = blindIndex(RAW_DOC_NUMBER);

// Mock only the genuinely external boundary calls (S3 download + OCR
// provider) — DB, Redis, and modules/document-scan/domain.ts's real field
// mapping all run for real, matching this suite's existing
// tests/document-scan-consumer.test.ts mocking scope minus its ioredis/db
// mocks (this test needs those to be real to prove the mismatch).
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({
    send: async () => ({ Body: (async function* () { yield Buffer.from("fake-image"); })() }),
  })),
  GetObjectCommand: vi.fn(),
}));
vi.mock("../src/modules/document-scan/ocr-adapter.js", () => ({
  performOcr: vi.fn(async () => ({
    fields: {
      full_name: "AUDIT Blacklisted Scan Subject",
      id_document_number: RAW_DOC_NUMBER,
    },
    confidence_scores: { full_name: 96, id_document_number: 96 },
  })),
}));

let rawRedis: Redis;

beforeAll(async () => {
  rawRedis = new Redis(process.env.REDIS_URL!);

  // Real canonical add-path: exactly what modules/blacklist/consumer.ts's
  // blacklistApprove handler does after a live approval commits.
  await addToBlacklistHashSet(TENANT, CANONICAL_HASH);

  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Doc-Scan Mismatch Test Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(devices).values({
        id: DEVICE_ID, tenantId: TENANT, deviceType: "scanner", name: "AUDIT Scanner",
        serialNumber: "AUDIT-SCN-" + randomUUID().slice(0, 8), locationId: LOCATION,
        authType: "bearer_token", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(ocrResults).where(eq(ocrResults.scanSessionId, SESSION_ID));
      await tx.delete(scanSessions).where(eq(scanSessions.id, SESSION_ID));
      await tx.delete(devices).where(eq(devices.id, DEVICE_ID));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
  await rawRedis.del(`visitor:${TENANT}:blacklist:hashes`);
  await rawRedis.del(`visitor:${TENANT}:blacklist:docs`);
  rawRedis.disconnect();
});

describe("document-scan blacklist screening — real Redis key + hash algorithm mismatch", () => {
  it("sanity: the canonical add-path really did write the real blacklist set (visitor:{tid}:blacklist:hashes)", async () => {
    expect(await isBlacklisted(TENANT, CANONICAL_HASH)).toBe(true);
    expect(await rawRedis.sismember(`visitor:${TENANT}:blacklist:hashes`, CANONICAL_HASH)).toBe(1);
  });

  it("BUG: document-scan reads a DIFFERENT Redis key ('...:blacklist:docs') that the canonical add-path never writes to", async () => {
    expect(await rawRedis.sismember(`visitor:${TENANT}:blacklist:docs`, CANONICAL_HASH)).toBe(0);
  });

  it("BUG: document-scan's own hash for the SAME document number does not even match the canonical hash", () => {
    expect(SCAN_TIME_HASH).not.toBe(CANONICAL_HASH);
  });

  it.fails("[BUG] scanning an actively blacklisted person's ID should set ocr_results.blacklistMatch", async () => {
    // createQueue(), not `new MemoryQueue()` — see check-in-watchlist-raw-hash-mismatch
    // test for why the consumer's own db.transaction() calls need the
    // withTenantConsumer decoration to satisfy RLS.
    const queue = createQueue() as MemoryQueue;
    const { registerDocumentScanConsumers } = await import("../src/modules/document-scan/consumer.js");
    registerDocumentScanConsumers(queue);

    await queue.publish(COMMANDS.scanProcess, {
      type: COMMANDS.scanProcess,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-scan-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { sessionId: SESSION_ID, tenantId: TENANT, deviceId: DEVICE_ID, imageStorageKey: "audit/fake.jpg" },
    });
    await queue.drain();

    const [ocr] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(ocrResults).where(eq(ocrResults.scanSessionId, SESSION_ID))),
    );
    // CORRECT behavior: this exact document number is genuinely, actively
    // blacklisted (added via the real approve path above) — the scan
    // should have flagged it. Today it never does, for either of the two
    // independent reasons proven above.
    expect(ocr?.blacklistMatch).toBe(true);
  });
});

describe("document-scan EVENTS.scanBlacklistMatch — zero subscribers anywhere in this service", () => {
  it.fails("[BUG] some consumer in this service subscribes to EVENTS.scanBlacklistMatch", () => {
    const modulesDir = join(__dirname, "../src/modules");
    let found = false;
    let scannedAtLeastOne = false;
    for (const mod of readdirSync(modulesDir)) {
      const consumerPath = join(modulesDir, mod, "consumer.ts");
      try {
        const src = readFileSync(consumerPath, "utf8");
        scannedAtLeastOne = true;
        if (/\.subscribe[^(]*\(\s*EVENTS\.scanBlacklistMatch/.test(src)) {
          found = true;
          break;
        }
      } catch {
        // this module has no consumer.ts — expected for many modules, skip.
      }
    }
    // Guard against a vacuous pass if the directory layout ever changes.
    expect(scannedAtLeastOne).toBe(true);
    // scanBlacklistMatch IS published (document-scan/consumer.ts:291-304)
    // but, per this repo-wide scan, nothing ever queue.subscribe()s to it —
    // a genuine blacklist hit during a document scan is enqueued into the
    // void. (No route reads ocr_results.blacklistMatch either — it is
    // stored and never consulted anywhere, including at check-in.)
    expect(found).toBe(true);
  });
});
