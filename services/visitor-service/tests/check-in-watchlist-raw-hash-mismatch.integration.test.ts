/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — watchlist screening at check-in
 * is silently non-functional because it hashes the wrong value.
 *
 * `modules/check-in/consumer.ts`'s `checkInRecord` handler builds its
 * post-commit watchlist check from `visit?.identityDocRef` — the visitor's
 * RAW, decrypted identity-document reference (`visit-request/schema.ts`:
 * `identityDocRef: encryptedText("identity_doc_ref")`, transparently
 * decrypted to cleartext by Drizzle on read) — and hands it straight to
 * `isWatchlisted()`, naming the field `identityDocHash` as though it
 * already were one:
 *
 *   identityDocHash: visit?.identityDocRef ?? null,               // consumer.ts:239
 *   ...
 *   const flagged = await isWatchlisted(msg.tenantId, committed.identityDocHash);  // consumer.ts:307
 *
 * But `isWatchlisted()` (modules/blacklist/screening-store.ts) performs a
 * Redis SISMEMBER against `visitor:{tid}:watchlist:hashes`, a set that is
 * populated EXCLUSIVELY with the deterministic HMAC blind index produced by
 * `modules/blacklist/blind-index.ts#identityDocHash(docNumber, docType)` —
 * see `modules/blacklist/consumer.ts`'s `watchlistAdd` handler (the only
 * writer of that set) and `modules/visit-request/routes.ts`'s own,
 * CORRECTLY-hashed blacklist screen at submission time. A blind index is a
 * keyed HMAC-SHA256 hex digest of `"{docType}:{docNumber}"` — a raw
 * document number can never coincidentally equal one. So `isWatchlisted()`
 * at check-in ALWAYS returns false, no matter how genuinely the visitor is
 * watchlisted: the `watchlist_flagged_check_in` log line and the
 * NOTIFICATION_SEND to `security_control_room` (Requirement 5.7) are dead
 * code in production. A second, independent finding elsewhere in this PR
 * shows `document-scan`'s OWN blacklist/watchlist screening is broken for
 * unrelated reasons (wrong Redis key + wrong hash) — so, taken together,
 * watchlist/blacklist screening at BOTH real-world touchpoints downstream
 * of initial submission (document scan and check-in) never actually fires.
 *
 * This test builds a genuinely watchlisted visitor via the REAL, correct
 * add-path (`addToWatchlistHashSet` + the real `identityDocHash()` blind
 * index — exactly what `modules/blacklist/consumer.ts`'s `watchlistAdd`
 * handler does after a live watchlist entry is created), drives a real
 * check-in through the real `registerCheckInConsumers` handler against the
 * live Postgres DB (via `createQueue()` + the same outbox/DB machinery
 * production uses), and proves the alert never fires even though the
 * fixture is a genuine, active, correctly-hashed watchlist match.
 *
 * Overlap note: PR #702 (lifecycle cluster, which owns check-in) also
 * documents this exact root cause (`tests/check-in-watchlist-consumer-hash.test.ts`),
 * confirming it independently. That test mocks db/outbox/roster and asserts
 * on spy call args; this one is kept alongside it because it instead drives
 * the real consumer against the live Postgres DB end-to-end — a genuinely
 * watchlisted fixture, added via the real Redis-backed add-path, that
 * still never produces the expected outbox notification. Two independent
 * confirmations, one mocked and one fully live, of the same bug.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { isWatchlisted, addToWatchlistHashSet } from "../src/modules/blacklist/screening-store.js";
import { identityDocHash } from "../src/modules/blacklist/blind-index.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
const PASS_ID = randomUUID();
const CORR = `corr-watchlist-${randomUUID()}`;

const RAW_DOC_REF = "AUDIT-WATCHLIST-AADHAAR-0007";
const DOC_TYPE = "aadhaar";
const CORRECT_HASH = identityDocHash(RAW_DOC_REF, DOC_TYPE);

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

beforeAll(async () => {
  // Real watchlist add-path — the same call `modules/blacklist/consumer.ts`'s
  // `watchlistAdd` handler makes after a live watchlist entry commits.
  await addToWatchlistHashSet(TENANT, CORRECT_HASH);

  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Watchlist Test Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "Watchlist Test Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Watchlisted Visitor", visitorPhone: "+919900011122",
        identityDocType: DOC_TYPE, identityDocRef: RAW_DOC_REF,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
        locationId: LOCATION, passNumber: "WLH" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "active", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.passId, PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("check-in watchlist screening — raw identity ref vs. the real blind-index hash", () => {
  it("sanity: the correctly-hashed identity IS genuinely on the watchlist", async () => {
    expect(await isWatchlisted(TENANT, CORRECT_HASH)).toBe(true);
  });

  it("BUG: the raw identityDocRef the consumer actually passes to isWatchlisted() is NOT on the watchlist", async () => {
    // Same identity, same tenant — only the lookup KEY differs from the
    // sanity check above (raw string vs. HMAC blind index).
    expect(await isWatchlisted(TENANT, RAW_DOC_REF)).toBe(false);
  });

  it("[FIXED] a real check-in for a genuinely (correctly-hashed) watchlisted visitor raises a security-control-room alert", async () => {
    // createQueue() (not `new MemoryQueue()` directly) so `.subscribe` gets
    // the production `withTenantConsumer` decoration — the consumer's own
    // db.transaction() calls need the AsyncLocalStorage tenant context that
    // decoration provides to satisfy RLS, exactly as src/app.ts wires it.
    const queue = createQueue() as MemoryQueue;
    registerCheckInConsumers(queue);

    await queue.publish(COMMANDS.checkInRecord, {
      type: COMMANDS.checkInRecord,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: CORR,
      schemaVersion: "1.0",
      payload: { passId: PASS_ID, gateId: GATE },
    });
    // MemoryQueue.drain() resolves once the checkInRecord handler (which
    // runs the watchlist check synchronously, in the same async function,
    // after its DB transaction commits) has fully settled.
    await queue.drain();

    const rows = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(outboxMessages).where(
        and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.correlationId, CORR)),
      )),
    );
    const watchlistAlert = rows.find((r) => {
      const payload = r.payload as { eventType?: string };
      return r.topic === "notification.send" && payload.eventType === EVENTS.watchlistMatched;
    });

    // CORRECT behavior (Requirement 5.7): a genuinely watchlisted visitor's
    // check-in enqueues a watchlistMatched NOTIFICATION_SEND to
    // security_control_room. Today this never happens — `watchlistAlert`
    // is undefined regardless of watchlist status, because the lookup key
    // is wrong (see the two tests above).
    expect(watchlistAlert).toBeDefined();
  });
});
