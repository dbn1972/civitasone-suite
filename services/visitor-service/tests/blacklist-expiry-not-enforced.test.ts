/**
 * blacklist screening — `expiresAt` is never enforced by the actual
 * screening path (domain.ts#isExpired exists but nothing calls it).
 *
 * SECURITY/COMPLIANCE AUDIT FINDING (HIGH — indefinite denial past the
 * authorized duration): `isBlacklisted()` (screening-store.ts), which is
 * what visit-request/routes.ts and check-in/routes.ts actually call to
 * decide whether to block someone, is a raw Redis/in-memory SISMEMBER
 * check against a hash set populated once at approval time
 * (blacklist/consumer.ts#blacklistApprove -> addToBlacklistHashSet). It has
 * no notion of time and never consults the entry's `expiresAt` or `status`.
 * `domain.ts#isExpired` is a pure function that is unit-tested in isolation
 * (blacklist-domain-deep.test.ts) but is NEVER called from any production
 * code path — grep confirms no worker/consumer/route reads it. There is
 * also no scheduled sweep job (unlike, e.g., dpdp/purge-worker.ts or
 * visit-request/auto-reject-worker.ts) that removes expired hashes from the
 * screening set or flips the DB row's status from 'active' to 'expired'.
 *
 * Net effect, reproduced LIVE against the running audit instance: a
 * blacklist entry approved with `expiresAt` set to 2020-01-01 (already six+
 * years expired at approval time) still returns `isBlacklisted() === true`
 * and still 403s a brand-new visit request in 2026. Once approved, a
 * blacklist entry blocks PERMANENTLY regardless of any expiresAt the
 * approving officer set — combined with there being no
 * remove/archive/reject/override route or command anywhere in this module
 * (topics.ts defines only blacklistAdd/blacklistApprove — no
 * blacklistArchive/Remove/Reject), there is no way to lift a block once
 * granted, other than direct DB intervention. For a government citizen-
 * facing system this is a real due-process concern, not just a stale-data
 * nuisance.
 *
 * This test documents the gap at the unit level: it shows the disconnect
 * between `isExpired()` (says "yes, this should no longer apply") and
 * `isBlacklisted()` (says "still blocked") for the exact same entry.
 * Mirrors blacklist-screening-store.test.ts's conventions (in-memory store
 * via setScreeningStoreForTests(null), CACHE_DRIVER=memory per
 * vitest.config.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  addToBlacklistHashSet,
  isBlacklisted,
  setScreeningStoreForTests,
} from "../src/modules/blacklist/screening-store.js";
import { isExpired } from "../src/modules/blacklist/domain.js";

const TENANT = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  setScreeningStoreForTests(null);
});

describe("blacklist expiry is not enforced by the screening path", () => {
  it("isExpired() correctly reports an already-past expiresAt as expired", () => {
    const longExpired = new Date("2020-01-01T00:00:00.000Z");
    expect(isExpired(longExpired, new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("BUG: isBlacklisted() still returns true for a hash whose entry's expiresAt has long passed", async () => {
    const hash = "doc-hash-already-expired";
    const expiresAt = new Date("2020-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:00.000Z");

    // This is exactly what blacklist/consumer.ts#blacklistApprove does on
    // approval: add the hash to the screening set. It does this
    // unconditionally — it does not check isExpired(expiresAt) first, and
    // nothing removes the hash later when expiresAt passes.
    expect(isExpired(expiresAt, now)).toBe(true); // the entry itself is expired...
    await addToBlacklistHashSet(TENANT, hash);
    expect(await isBlacklisted(TENANT, hash)).toBe(true); // ...but screening ignores that entirely.
  });

  it("BUG: no amount of elapsed time removes a hash from the screening set on its own", async () => {
    const hash = "doc-hash-never-swept";
    await addToBlacklistHashSet(TENANT, hash);
    expect(await isBlacklisted(TENANT, hash)).toBe(true);

    // Simulate "time passing" — there is no sweep/expiry worker to invoke,
    // which is itself the point: nothing in this module ever calls srem
    // on the blacklist hash-set keys (unlike, e.g.,
    // recurring-pass/revocation-store.ts's srem for revoked-pass keys).
    // The hash remains blocked forever, or until the *next* successful
    // add/approve for that tenant happens to overwrite unrelated state
    // (it never does, since Redis Sets only grow via SADD in this module).
    expect(await isBlacklisted(TENANT, hash)).toBe(true);
  });
});
