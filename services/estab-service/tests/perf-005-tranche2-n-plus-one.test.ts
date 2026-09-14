/**
 * PERF-005 tranche 2 regression test — estab-service.
 *
 * NOTE ON SCOPE: estab-service was not named at all in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's original PERF-005/PERF-019 rows.
 * This is a newly-discovered N+1 found by an independent codebase-wide grep
 * for the same anti-pattern (a `.map(async ...)` doing per-row DB calls after
 * an initial list query). See this tranche's PR description for the full
 * list of newly-discovered sites.
 *
 * Covers:
 *   - committee/queries.ts::listMeetingSummaries (was 2N+1 via
 *     countsForMeeting() -> findAttendeesByMeeting()+findResolutionsByMeeting()
 *     per meeting row, fetching full rows just to take `.length`)
 *
 * Tested at the queries.ts function level directly (like grant/citizen's
 * PERF-005/PERF-019 tests) rather than through the HTTP route: booting the
 * full app (as tests/committee-meeting-counts.test.ts, this module's
 * existing correctness test, does) starts background app-level machinery
 * whose own incidental queries can land inside the measured window and make
 * an O(1)-vs-O(N) comparison noisy. Correctness (attendeesCount/
 * agendaItemsCount actually being right) is already covered end-to-end by
 * that sibling test and is unaffected by this file's query-count focus.
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring), only counting anything when DB_QUERY_DEBUG=true is
 * set at test-run time — mirrors PERF-005/PERF-019's own test files.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabCommittees, estabMeetings, estabResolutions, estabAttendees } from "../src/modules/committee/schema.js";
import { listMeetingSummaries } from "../src/modules/committee/queries.js";

const ACTOR = "60000000-aaaa-4000-8000-000000000001";
const SMALL_N = 3;
const LARGE_N = 20;

async function seed(tenant: string, n: number) {
  const committeeId = randomUUID();
  const meetings = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), tenantId: tenant, committeeId, title: `Meeting ${i}`,
    whenAt: new Date("2026-03-01T10:00:00Z"), status: "completed", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  // 2 resolutions + 1 attendee per meeting, so a broken batch (or one that
  // drops counts for any meeting) is visible per-row, not just in aggregate.
  const resolutions = meetings.flatMap((m, i) => [1, 2].map((seq) => ({
    id: randomUUID(), tenantId: tenant, meetingId: m.id, seq, body: `Resolution ${i}-${seq}`,
    status: "pending", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  const attendees = meetings.map((m) => ({
    id: randomUUID(), tenantId: tenant, meetingId: m.id, memberRef: randomUUID(),
    role: "member", attended: true, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(estabCommittees).values({
      id: committeeId, tenantId: tenant, name: "PERF-005 T2 Committee", chairRef: ACTOR,
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(estabMeetings).values(meetings);
    await tx.insert(estabResolutions).values(resolutions);
    await tx.insert(estabAttendees).values(attendees);
  }));
  return { meetings };
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(estabAttendees).where(eq(estabAttendees.tenantId, tenant));
    await tx.delete(estabResolutions).where(eq(estabResolutions.tenantId, tenant));
    await tx.delete(estabMeetings).where(eq(estabMeetings.tenantId, tenant));
    await tx.delete(estabCommittees).where(eq(estabCommittees.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-005 tranche 2 — estab-service N+1 fix", () => {
  it("listMeetingSummaries: query count is O(1) not O(N), attendeesCount/agendaItemsCount stay correct (was 2N+1)", async () => {
    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seed(tenantSmall, SMALL_N);
    const large = await seed(tenantLarge, LARGE_N);
    try {
      // Warm-up (untimed, against tenantSmall's real seeded rows -- an empty
      // result short-circuits countAttendeesByMeetingIds/
      // countResolutionsByMeetingIds before they ever query, so it would not
      // exercise the thing being warmed up here): postgres-js resolves the
      // element-type OID for an array-bound parameter (inArray(meetingIds))
      // lazily on its first use per process, as its own extra round trip --
      // a one-time driver cost, not an application query, that would
      // otherwise land arbitrarily on whichever of the two MEASURED calls
      // below happens to run first and break the O(1) comparison. Confirmed
      // via a driver-level query-log capture during this fix's own
      // debugging (not committed): SMALL showed a
      // `pg_catalog.pg_type ... typarray` round trip between its two
      // grouped-count queries that LARGE did not, on a plain rerun-in-the-
      // same-process ordering with no such warm-up.
      //
      // Deliberately limit=1 here, NOT 100 (the limit the SMALL measurement
      // below also uses): listMeetingSummaries()'s list portion is itself
      // cache.getOrLoad()-cached, keyed on `${tenantId}:meetings:list:${limit}`.
      // Warming up with limit=100 against tenantSmall silently primed THAT
      // exact cache entry, so the SMALL measurement below got a free cache
      // hit on its own list read (skipping its db.transaction()-wrapped
      // SELECT -- BEGIN/`SET LOCAL app.tenant_id`(wrapWithTenantGuc)/SELECT/
      // COMMIT, 4 round trips) while LARGE (a different, never-warmed tenant)
      // always paid for it -- a deterministic 4-query gap having nothing to
      // do with the OID lookup or the N+1 fix under test, caught by this
      // session re-running the suite (countSmall=8, countLarge=12, every
      // time, not the +/-1 flake the OID lookup alone would cause). A
      // distinct limit keeps the warm-up's cache key disjoint from both
      // measured calls' (`list:1` vs `list:100`), so neither gets an unfair
      // cache advantage over the other.
      await runWithTenant(tenantSmall, () => listMeetingSummaries(tenantSmall, 1));

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listMeetingSummaries(tenantSmall, 100)));
      const { result: rows, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listMeetingSummaries(tenantLarge, 100)));

      // O(1): identical round-trip count whether the tenant has 3 meetings or
      // 20. The old countsForMeeting() (2 full-row-fetch queries) per meeting
      // row would have made ~34 more queries for the 20-meeting tenant.
      // Ceiling is 16 (observed stable at 12 across repeated local runs: 3
      // db.transaction()-wrapped calls -- listMeetingsByTenant,
      // countAttendeesByMeetingIds, countResolutionsByMeetingIds -- each
      // BEGIN/`SET LOCAL app.tenant_id`(wrapWithTenantGuc)/SELECT/COMMIT, 4
      // round trips apiece), padded like this tranche's other services'
      // thresholds for headroom against incidental driver-level variance.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(16);

      expect(rows).toHaveLength(LARGE_N);
      const meetingIds = new Set(large.meetings.map((m) => m.id));
      for (const row of rows) {
        expect(meetingIds.has(row.id)).toBe(true);
        expect(row.attendeesCount).toBe(1);
        expect(row.agendaItemsCount).toBe(2);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
