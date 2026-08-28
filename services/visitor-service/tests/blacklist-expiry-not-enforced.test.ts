/**
 * blacklist screening — `expiresAt` enforcement (Fix 3).
 *
 * SECURITY/COMPLIANCE AUDIT FINDING, now fixed (was HIGH — indefinite
 * denial past the authorized duration): `isBlacklisted()`
 * (screening-store.ts), which is what visit-request/routes.ts and
 * check-in/routes.ts actually call to decide whether to block someone, used
 * to be a raw Redis/in-memory SISMEMBER check against a hash set populated
 * once at approval time (blacklist/consumer.ts#blacklistApprove ->
 * addToBlacklistHashSet). It had no notion of time and never consulted the
 * entry's `expiresAt` or `status`. `domain.ts#isExpired` is a pure function
 * that is unit-tested in isolation (blacklist-domain-deep.test.ts) but,
 * before this fix, was NEVER called from any production code path.
 *
 * The fix (screening-store.ts): the underlying store switched from a plain
 * Redis Set to a sorted set keyed by expiry (ZADD/ZSCORE/ZREM), with
 * `addToBlacklistHashSet` now accepting the entry's `expiresAt` (threaded
 * through from blacklist/consumer.ts#blacklistApprove, which already had
 * the DB row's `expiresAt` in hand) and `isBlacklisted` treating an expired
 * member as absent — lazily evicting it, so the set self-heals on read
 * without a separate sweep worker. This is backward compatible: a member
 * added with no expiresAt (e.g. every watchlist entry, or a permanent
 * blacklist entry) keeps blocking forever exactly as before.
 *
 * A companion fix (blacklist/routes.ts + consumer.ts) adds
 * `POST /v1/visitor/blacklist/:id/deactivate` (COMMANDS.blacklistDeactivate)
 * — before this, there was no route/command anywhere that could lift or
 * remove a blacklist entry at all (topics.ts only defined
 * blacklistAdd/blacklistApprove).
 *
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

describe("blacklist expiry is enforced by the screening path (Fix 3)", () => {
  it("isExpired() correctly reports an already-past expiresAt as expired", () => {
    const longExpired = new Date("2020-01-01T00:00:00.000Z");
    expect(isExpired(longExpired, new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("isBlacklisted() returns false once the entry's expiresAt has passed", async () => {
    const hash = "doc-hash-already-expired";
    // Long in the past relative to real wall-clock time — isBlacklisted()
    // compares against Date.now(), not a fixed/injected "now".
    const expiresAt = new Date("2020-01-01T00:00:00.000Z");

    expect(isExpired(expiresAt, new Date())).toBe(true); // the entry itself is expired...
    // This is exactly what blacklist/consumer.ts#blacklistApprove now does
    // on approval: add the hash to the screening set WITH its expiresAt.
    await addToBlacklistHashSet(TENANT, hash, expiresAt);
    expect(await isBlacklisted(TENANT, hash)).toBe(false); // ...and screening now honours that.
  });

  it("isBlacklisted() still returns true for an entry whose expiresAt has NOT yet passed", async () => {
    const hash = "doc-hash-not-yet-expired";
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now

    await addToBlacklistHashSet(TENANT, hash, expiresAt);
    expect(await isBlacklisted(TENANT, hash)).toBe(true);
  });

  it("an entry with no expiresAt (permanent) never expires — correct behavior, not a bug", async () => {
    const hash = "doc-hash-never-swept";
    await addToBlacklistHashSet(TENANT, hash);
    expect(await isBlacklisted(TENANT, hash)).toBe(true);

    // A permanent entry (null expiresAt, matching domain.ts#isExpired's own
    // "null means never expires" convention) has no time bound at all —
    // this is intentional, not the bug this file used to document. Lifting
    // a permanent entry now goes through the new blacklistDeactivate
    // command/route instead (blacklist/commands.ts, blacklist/routes.ts).
    expect(await isBlacklisted(TENANT, hash)).toBe(true);
  });
});
