/**
 * Evacuation roster — Property 23 (counter must always equal the hash's
 * entry count) under repeat/duplicate calls and true concurrency.
 *
 * tests/evacuation-roster.test.ts already covers the well-behaved sequential
 * case (each passId added/removed at most once). This file targets the gap:
 * roster.ts's public contract must also enforce Property 23 against a
 * REPEATED call for the same passId, since that repeat is reachable through
 * a documented, legitimate production code path — not just a hypothetical:
 *
 *   - modules/check-in/domain.ts#checkIn (lines ~210-219) explicitly ALLOWS a
 *     `passType: "recurring"` pass with `multiEntryRecurring: true` to check
 *     in again while `currentStatus === "checked_in"` (no
 *     PASS_ALREADY_CHECKED_IN error in that case — see the docstring:
 *     "rejecting a duplicate check-in without a preceding check-out UNLESS
 *     the pass is a multi-entry recurring pass").
 *   - modules/check-in/consumer.ts calls `addToRoster(...)` unconditionally
 *     on every successful check-in (no "already on roster" guard).
 *   - addToRoster's `hset` is an idempotent overwrite for a repeat passId, so
 *     its paired counter adjustment must ALSO be conditioned on membership
 *     actually changing (Redis HSET's return value: 1 = new field, 0 =
 *     existing field overwritten) — otherwise a second, legitimate check-in
 *     would increment COUNT_KEY a second time while the Hash gains no new
 *     entry.
 *
 * Symmetrically, removeFromRoster must not `decr` when `hdel` on a
 * non-member passId is a no-op (e.g. a checkout for a pass not currently on
 * the roster, or a redelivered/duplicate checkOutRecord) — an unconditional
 * decr would drive the counter BELOW the true occupancy, which is the more
 * dangerous direction during an actual emergency headcount (undercounting
 * who is still inside). Redis HDEL's return value (>0 fields actually
 * removed) is what gates the decr.
 *
 * Both are exercised below with plain sequential calls (no timing flakiness
 * required to prove the contract), plus a genuine Promise.all concurrency
 * test showing the primitive is fine for the normal case of distinct
 * passIds racing each other.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  addToRoster,
  getFullRoster,
  getVisitorCount,
  removeFromRoster,
  setRosterStoreForTests,
  type RosterEntry,
} from "../src/modules/evacuation/roster.js";

function entry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    passId: "pass-1",
    visitorName: "Jane Visitor",
    hostName: "Host Officer",
    checkInTime: "2026-01-01T09:00:00.000Z",
    lastKnownGate: "Gate 1",
    contactNumber: "9999999999",
    evacuated: false,
    ...overrides,
  };
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const LOCATION = "loc-a";

beforeEach(() => {
  setRosterStoreForTests(null);
});

describe("Property 23 held — repeat addToRoster for an already-present passId (multi-entry recurring re-check-in path)", () => {
  it("FIXED: a second addToRoster for the SAME passId still on the roster does not desync the counter from the hash (no over-count)", async () => {
    // First check-in.
    await addToRoster(TENANT, LOCATION, entry({ passId: "recurring-pass-1" }));
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(1);

    // A second, legitimate re-check-in of the SAME still-checked-in recurring
    // pass (check-in/domain.ts#checkIn permits this transition; the consumer
    // calls addToRoster unconditionally either way).
    await addToRoster(TENANT, LOCATION, entry({ passId: "recurring-pass-1", checkInTime: "2026-01-01T10:00:00.000Z" }));

    const roster = await getFullRoster(TENANT, LOCATION);
    const count = await getVisitorCount(TENANT, LOCATION);

    // The Hash correctly still has exactly ONE entry for this passId (hset
    // overwrote in place) ...
    expect(roster).toHaveLength(1);
    // ... and the counter was NOT incremented a second time, because hset
    // reported the field already existed. Property 23 holds: an evacuation
    // headcount read via getVisitorCount() no longer overstates occupancy
    // for a multi-entry recurring visitor who re-entered without an
    // intervening checkout.
    expect(count).toBe(1);
    expect(count).toBe(roster.length); // <- the invariant roster.ts's own docs promise
  });

  it("compounding: three re-entries of the same pass do not drift the counter", async () => {
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));

    expect((await getFullRoster(TENANT, LOCATION)).length).toBe(1);
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(1);
  });
});

describe("Property 23 held — removeFromRoster for a passId NOT on the roster (would otherwise undercount — the dangerous direction)", () => {
  it("FIXED: removing a passId that was never added does not drive the counter negative", async () => {
    await addToRoster(TENANT, LOCATION, entry({ passId: "pass-1" }));
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(1);

    // A checkout for a pass that isn't (or is no longer) on the roster — e.g.
    // a redelivered/duplicate checkOutRecord command, or any desync between
    // the check_ins table and the ephemeral roster mirror.
    await removeFromRoster(TENANT, LOCATION, "never-checked-in-pass");

    const roster = await getFullRoster(TENANT, LOCATION);
    const count = await getVisitorCount(TENANT, LOCATION);

    // The one real visitor is still correctly on the roster ...
    expect(roster).toHaveLength(1);
    // ... and the counter was NOT decremented, because hdel reported no
    // field was actually removed (a no-op).
    expect(count).toBe(1);
    expect(count).toBe(roster.length);
  });

  it("FIXED: a duplicate checkout (remove called twice for the same passId) does not drive the counter negative", async () => {
    await addToRoster(TENANT, LOCATION, entry({ passId: "pass-1" }));
    await removeFromRoster(TENANT, LOCATION, "pass-1");
    // Redelivery / retry of the same checkOutRecord command.
    await removeFromRoster(TENANT, LOCATION, "pass-1");

    expect(await getFullRoster(TENANT, LOCATION)).toEqual([]);
    // The first removeFromRoster genuinely removed the entry and correctly
    // decremented once; the redelivered second call found hdel a no-op and
    // did NOT decrement again, so the count bottoms out at zero rather than
    // going negative.
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(0);
  });
});

describe("true concurrency — distinct passIds racing each other stays consistent (the primitive is fine for the normal case)", () => {
  it("100 concurrent addToRoster calls for 100 distinct passIds: count always equals hash length", async () => {
    const passIds = Array.from({ length: 100 }, (_, i) => `concurrent-pass-${i}`);

    await Promise.all(passIds.map((passId) => addToRoster(TENANT, LOCATION, entry({ passId }))));

    const roster = await getFullRoster(TENANT, LOCATION);
    const count = await getVisitorCount(TENANT, LOCATION);
    expect(roster).toHaveLength(100);
    expect(count).toBe(100);
  });

  it("interleaved concurrent add + remove for distinct passIds converges to the correct consistent state", async () => {
    const toAdd = Array.from({ length: 50 }, (_, i) => `p-${i}`);
    await Promise.all(toAdd.map((passId) => addToRoster(TENANT, LOCATION, entry({ passId }))));

    const toRemove = toAdd.filter((_, i) => i % 2 === 0); // remove every other one
    const moreToAdd = Array.from({ length: 20 }, (_, i) => `q-${i}`);

    await Promise.all([
      ...toRemove.map((passId) => removeFromRoster(TENANT, LOCATION, passId)),
      ...moreToAdd.map((passId) => addToRoster(TENANT, LOCATION, entry({ passId }))),
    ]);

    const roster = await getFullRoster(TENANT, LOCATION);
    const count = await getVisitorCount(TENANT, LOCATION);
    expect(roster).toHaveLength(50 - toRemove.length + moreToAdd.length);
    expect(count).toBe(roster.length);
  });
});
