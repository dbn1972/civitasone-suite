/**
 * Evacuation roster — Property 23 (counter must always equal the hash's
 * entry count) under repeat/duplicate calls and true concurrency.
 *
 * tests/evacuation-roster.test.ts already covers the well-behaved sequential
 * case (each passId added/removed at most once). This file targets the gap:
 * roster.ts's own public contract does NOT enforce Property 23 against a
 * REPEATED call for the same passId, and that repeat is reachable through a
 * documented, legitimate production code path — not just a hypothetical:
 *
 *   - modules/check-in/domain.ts#checkIn (lines ~210-219) explicitly ALLOWS a
 *     `passType: "recurring"` pass with `multiEntryRecurring: true` to check
 *     in again while `currentStatus === "checked_in"` (no
 *     PASS_ALREADY_CHECKED_IN error in that case — see the docstring:
 *     "rejecting a duplicate check-in without a preceding check-out UNLESS
 *     the pass is a multi-entry recurring pass").
 *   - modules/check-in/consumer.ts calls `addToRoster(...)` unconditionally
 *     on every successful check-in (no "already on roster" guard).
 *   - addToRoster does `hset` (idempotent overwrite for a repeat passId)
 *     THEN `incr` (NOT idempotent) — so that second, legitimate check-in
 *     increments COUNT_KEY a second time while the Hash gains no new entry.
 *
 * Symmetrically, removeFromRoster unconditionally `decr`s even when `hdel`
 * on a non-member passId is a no-op (e.g. a checkout for a pass not
 * currently on the roster, or a redelivered/duplicate checkOutRecord) — this
 * drives the counter BELOW the true occupancy, which is the more dangerous
 * direction during an actual emergency headcount (undercounting who is
 * still inside).
 *
 * Both are demonstrated below with plain sequential calls (no timing
 * flakiness required to prove the contract is violable), plus a genuine
 * Promise.all concurrency test showing the primitive IS safe for the normal
 * case of distinct passIds racing each other.
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

describe("Property 23 violation — repeat addToRoster for an already-present passId (multi-entry recurring re-check-in path)", () => {
  it("BUG: a second addToRoster for the SAME passId still on the roster desyncs the counter from the hash (over-count)", async () => {
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
    // ... but the counter was incremented twice. This is the Property 23
    // break: count no longer equals the hash's entry count. An evacuation
    // headcount read via getVisitorCount() would now overstate occupancy by
    // one for every multi-entry recurring visitor who re-entered without an
    // intervening checkout.
    expect(count).toBe(2);
    expect(count).not.toBe(roster.length); // <- the invariant roster.ts's own docs promise is broken
  });

  it("compounding: three re-entries of the same pass triples the drift", async () => {
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));
    await addToRoster(TENANT, LOCATION, entry({ passId: "p1" }));

    expect((await getFullRoster(TENANT, LOCATION)).length).toBe(1);
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(3);
  });
});

describe("Property 23 violation — removeFromRoster for a passId NOT on the roster (undercount — the dangerous direction)", () => {
  it("BUG: removing a passId that was never added drives the counter negative", async () => {
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
    // ... but the counter was decremented for an hdel that was a no-op.
    expect(count).toBe(0);
    expect(count).not.toBe(roster.length);
  });

  it("BUG: a duplicate checkout (remove called twice for the same passId) drives the counter negative", async () => {
    await addToRoster(TENANT, LOCATION, entry({ passId: "pass-1" }));
    await removeFromRoster(TENANT, LOCATION, "pass-1");
    // Redelivery / retry of the same checkOutRecord command.
    await removeFromRoster(TENANT, LOCATION, "pass-1");

    expect(await getFullRoster(TENANT, LOCATION)).toEqual([]);
    // A NEGATIVE headcount is a clearly-wrong, clearly-visible symptom in
    // this contrived case — the dangerous real-world case is the OTHER
    // undercounting scenario above, where the count silently reads too LOW
    // by exactly one per stray removal while still looking plausible.
    expect(await getVisitorCount(TENANT, LOCATION)).toBe(-1);
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
