/**
 * Feature: visitor-management, Task 16.1 — modules/evacuation/roster.ts
 *
 * Unit tests covering the in-memory roster store fallback (CACHE_DRIVER=memory
 * per vitest.config.ts): add/remove/count consistency (Property 23 — the
 * counter must always equal the hash's entry count) and tenant/location
 * isolation (no cross-tenant or cross-location leakage).
 *
 * Requirements: 17.1, 17.2
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

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const LOCATION_A = "loc-a";
const LOCATION_B = "loc-b";

beforeEach(() => {
  // Reset to a fresh in-memory store between tests (CACHE_DRIVER=memory is
  // set in vitest.config.ts, so passing null re-derives a brand new
  // MemoryRosterStore rather than reusing accumulated state).
  setRosterStoreForTests(null);
});

describe("addToRoster / getFullRoster / getVisitorCount", () => {
  it("returns an empty roster and zero count for a location with no entries", async () => {
    expect(await getFullRoster(TENANT_A, LOCATION_A)).toEqual([]);
    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(0);
  });

  it("adds a visitor to the roster and increments the count", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));

    const roster = await getFullRoster(TENANT_A, LOCATION_A);
    expect(roster).toHaveLength(1);
    expect(roster[0]).toEqual(entry({ passId: "pass-1" }));
    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(1);
  });

  it("adding multiple visitors keeps the counter equal to the hash entry count (Property 23)", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-2" }));
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-3" }));

    const roster = await getFullRoster(TENANT_A, LOCATION_A);
    const count = await getVisitorCount(TENANT_A, LOCATION_A);
    expect(roster).toHaveLength(3);
    expect(count).toBe(roster.length);
  });
});

describe("removeFromRoster", () => {
  it("removes a visitor and decrements the count (Property 23)", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-2" }));

    await removeFromRoster(TENANT_A, LOCATION_A, "pass-1");

    const roster = await getFullRoster(TENANT_A, LOCATION_A);
    const count = await getVisitorCount(TENANT_A, LOCATION_A);
    expect(roster).toHaveLength(1);
    expect(roster[0]?.passId).toBe("pass-2");
    expect(count).toBe(1);
    expect(count).toBe(roster.length);
  });

  it("removing the last visitor brings the roster and count back to empty/zero", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));
    await removeFromRoster(TENANT_A, LOCATION_A, "pass-1");

    expect(await getFullRoster(TENANT_A, LOCATION_A)).toEqual([]);
    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(0);
  });

  it("counter and hash stay consistent across interleaved add/remove sequences (Property 23)", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "p1" }));
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "p2" }));
    await removeFromRoster(TENANT_A, LOCATION_A, "p1");
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "p3" }));
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "p4" }));
    await removeFromRoster(TENANT_A, LOCATION_A, "p3");

    const roster = await getFullRoster(TENANT_A, LOCATION_A);
    const count = await getVisitorCount(TENANT_A, LOCATION_A);
    expect(roster.map((r) => r.passId).sort()).toEqual(["p2", "p4"]);
    expect(count).toBe(roster.length);
  });
});

describe("tenant/location isolation", () => {
  it("does not leak roster entries across different tenants at the same location id", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));
    await addToRoster(TENANT_B, LOCATION_A, entry({ passId: "pass-2" }));

    const rosterA = await getFullRoster(TENANT_A, LOCATION_A);
    const rosterB = await getFullRoster(TENANT_B, LOCATION_A);

    expect(rosterA.map((r) => r.passId)).toEqual(["pass-1"]);
    expect(rosterB.map((r) => r.passId)).toEqual(["pass-2"]);
    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(1);
    expect(await getVisitorCount(TENANT_B, LOCATION_A)).toBe(1);
  });

  it("does not leak roster entries across different locations within the same tenant", async () => {
    await addToRoster(TENANT_A, LOCATION_A, entry({ passId: "pass-1" }));
    await addToRoster(TENANT_A, LOCATION_B, entry({ passId: "pass-2" }));
    await addToRoster(TENANT_A, LOCATION_B, entry({ passId: "pass-3" }));

    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(1);
    expect(await getVisitorCount(TENANT_A, LOCATION_B)).toBe(2);

    await removeFromRoster(TENANT_A, LOCATION_B, "pass-2");

    expect(await getVisitorCount(TENANT_A, LOCATION_A)).toBe(1);
    expect(await getVisitorCount(TENANT_A, LOCATION_B)).toBe(1);
    expect((await getFullRoster(TENANT_A, LOCATION_A))[0]?.passId).toBe("pass-1");
  });
});
