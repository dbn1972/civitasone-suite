/**
 * CROSS-MODULE INTEGRATION FINDING (CRITICAL — life-safety, FIXED) — group
 * bulk check-in used to mark every member's digital pass `checked_in` but
 * never touch the real-time evacuation roster or the check-in audit trail,
 * and skipped the capacity-threshold alert that individual check-in always
 * runs. group-visit/consumer.ts's groupBulkCheckIn now reads each member's
 * pass status first (state-machine parity), inserts a check_ins row,
 * adds each member to the evacuation roster, and runs the same post-commit
 * capacity-threshold check as check-in/consumer.ts — see that file's
 * "BUG FIX" comments for the implementation.
 *
 * `modules/group-visit/consumer.ts`'s `groupBulkCheckIn` handler
 * (COMMANDS.groupBulkCheckIn) does its own, parallel, ad-hoc version of
 * "check someone in" instead of routing each member through
 * `modules/check-in/consumer.ts`'s real `checkInRecord` handler:
 *
 *   for (const member of members) {
 *     UPDATE digital_passes SET status = 'checked_in' ...      // consumer.ts:275-278
 *     UPDATE group_members SET checked_in = true ...
 *   }
 *   enqueue ONE aggregate EVENTS.visitorCheckedIn for the whole group
 *
 * Compare `modules/check-in/consumer.ts`'s individual `checkInRecord`
 * handler, which on every single check-in additionally:
 *   - INSERTs a `check_ins` row (the audit-trail table group check-in
 *     never writes to at all)
 *   - runs the Requirement 19.5 / Property 28 capacity-threshold check
 *     and alerts security on breach
 *   - calls `addToRoster()` (modules/evacuation/roster.ts) — the Redis
 *     roster the break-glass, IP-allowlisted `GET /v1/visitor/evacuation/
 *     roster` endpoint reads during an actual emergency
 *
 * `groupBulkCheckIn` does NONE of these three. The DB-backed "who's
 * currently inside" view (`GET /v1/visitor/check-ins/active`, which joins
 * on `digital_passes.status`) DOES still show group members as checked in
 * — but the roster used specifically for evacuation accounting silently
 * does not, and no `check_ins` row backs their entry for gate-level audit
 * either. In an actual evacuation, security pulling the roster would get a
 * headcount that is missing every visitor who arrived as part of a group
 * visit, while the system elsewhere reports them as present inside the
 * building.
 *
 * This test proves the gap live, AND proves the roster mechanism itself is
 * not simply broken/unconfigured — a normal individual check-in (at its own
 * uncapped location, in the same test run, to avoid the group location's
 * deliberately-exhausted capacityThreshold) correctly appears on the roster.
 *
 * Overlap note: PR #702 (lifecycle cluster, which owns group-visit) also
 * documents this same root cause (`tests/group-bulk-checkin-bypass.test.ts`,
 * mocked) and additionally found that a bulk check-in force-sets pass
 * status without reading it first, silently reactivating an
 * individually-revoked member's pass — a real, distinct finding this file
 * does not cover. Kept alongside it because this version drives the real
 * consumer against the live Postgres DB end-to-end (real `createQueue()`
 * wiring, real evacuation roster reads) and additionally proves two things
 * their description doesn't mention: the capacity-threshold alert is also
 * silently skipped for bulk check-ins, and — via the contrast test below —
 * the roster mechanism itself is provably fine, isolating the bug
 * specifically to the group-visit consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerGroupVisitConsumers } from "../src/modules/group-visit/consumer.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { getFullRoster } from "../src/modules/evacuation/roster.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { groupVisits, groupMembers } from "../src/modules/group-visit/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();

const GROUP_VISIT_REQUEST_ID = randomUUID();
const GROUP_VISIT_ID = randomUUID();
const MEMBER_1_ID = randomUUID();
const MEMBER_2_ID = randomUUID();
const MEMBER_1_PASS_ID = randomUUID();
const MEMBER_2_PASS_ID = randomUUID();

// A separate, non-group visitor used only to prove the roster mechanism
// itself works correctly via the normal individual check-in path. Deliberately
// checked in at its OWN location/gate (default capacityThreshold, well above
// 1), not the group's LOCATION — that location's capacityThreshold=1 is
// intentionally exhausted by the 2-member bulk check-in above (see the
// capacity-alert test below), and check-in/consumer.ts now correctly ENFORCES
// that threshold (assertWithinCapacity, throws CAPACITY_EXCEEDED and rolls
// back the transaction — see its call site's comment). Reusing LOCATION here
// would make this "contrast" check hit that real, correct enforcement and
// fail for a reason that has nothing to do with the roster mechanism this
// test exists to isolate.
const SOLO_LOCATION = randomUUID();
const SOLO_GATE = randomUUID();
const SOLO_VISIT_REQUEST_ID = randomUUID();
const SOLO_PASS_ID = randomUUID();

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

function freshPass(id: string, visitRequestId: string, locationId: string = LOCATION) {
  return {
    id, tenantId: TENANT, visitRequestId, locationId,
    passNumber: "GRP" + Math.floor(Math.random() * 1e6), passType: "single" as const,
    status: "active" as const, qrJwt: "audit.fixture.jwt",
    validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
    createdBy: ACTOR, updatedBy: ACTOR,
  };
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      // capacityThreshold=1 so a 2-person bulk check-in should (correctly)
      // breach it — used by the capacity-alert assertion below.
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Group Roster Gap Test Loc",
        businessHours: BUSINESS_HOURS, capacityThreshold: 1,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "Group Roster Gap Test Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });

      // Solo visitor's own location — default capacityThreshold (450, see
      // location/schema.ts), so the contrast check-in below is never blocked
      // by the group location's deliberately-exhausted threshold=1.
      await tx.insert(locations).values({
        id: SOLO_LOCATION, tenantId: TENANT, name: "Group Roster Gap Test Solo Loc",
        businessHours: BUSINESS_HOURS,
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: SOLO_GATE, tenantId: TENANT, locationId: SOLO_LOCATION, name: "Group Roster Gap Test Solo Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });

      await tx.insert(visitRequests).values({
        id: GROUP_VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Group Lead", visitorPhone: "+919900055566",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(groupVisits).values({
        id: GROUP_VISIT_ID, tenantId: TENANT, groupName: "AUDIT Roster Gap Group",
        memberCount: 2, purpose: "cross-module audit repro",
        visitRequestId: GROUP_VISIT_REQUEST_ID, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values([
        freshPass(MEMBER_1_PASS_ID, GROUP_VISIT_REQUEST_ID),
        freshPass(MEMBER_2_PASS_ID, GROUP_VISIT_REQUEST_ID),
      ]);
      await tx.insert(groupMembers).values([
        {
          id: MEMBER_1_ID, tenantId: TENANT, groupVisitId: GROUP_VISIT_ID,
          memberName: "AUDIT Group Member One", passId: MEMBER_1_PASS_ID,
          blacklisted: false, createdBy: ACTOR,
        },
        {
          id: MEMBER_2_ID, tenantId: TENANT, groupVisitId: GROUP_VISIT_ID,
          memberName: "AUDIT Group Member Two", passId: MEMBER_2_PASS_ID,
          blacklisted: false, createdBy: ACTOR,
        },
      ]);

      // Solo visitor/pass for the roster-mechanism contrast check — at its
      // own SOLO_LOCATION, not the group's capacity-exhausted LOCATION.
      await tx.insert(visitRequests).values({
        id: SOLO_VISIT_REQUEST_ID, tenantId: TENANT, locationId: SOLO_LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Solo Visitor", visitorPhone: "+919900055577",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values(freshPass(SOLO_PASS_ID, SOLO_VISIT_REQUEST_ID, SOLO_LOCATION));
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.locationId, LOCATION));
      await tx.delete(checkIns).where(eq(checkIns.locationId, SOLO_LOCATION));
      await tx.delete(groupMembers).where(eq(groupMembers.groupVisitId, GROUP_VISIT_ID));
      await tx.delete(groupVisits).where(eq(groupVisits.id, GROUP_VISIT_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, MEMBER_1_PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, MEMBER_2_PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, SOLO_PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, GROUP_VISIT_REQUEST_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, SOLO_VISIT_REQUEST_ID));
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(gates).where(eq(gates.id, SOLO_GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
      await tx.delete(locations).where(eq(locations.id, SOLO_LOCATION));
    }),
  );
});

describe("group bulk check-in vs. individual check-in — evacuation roster parity", () => {
  it("sanity: group bulk check-in does mark both members' passes checked_in", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — RLS-safe
    registerGroupVisitConsumers(queue);

    await queue.publish(COMMANDS.groupBulkCheckIn, {
      type: COMMANDS.groupBulkCheckIn,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-group-bulk-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { groupVisitId: GROUP_VISIT_ID, tenantId: TENANT, actualHeadcount: 2, gateId: GATE },
    });
    await queue.drain();

    const rows = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(
        and(eq(digitalPasses.tenantId, TENANT), eq(digitalPasses.visitRequestId, GROUP_VISIT_REQUEST_ID)),
      )),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "checked_in")).toBe(true);
  });

  it("[FIXED] both group members appear on the real-time evacuation roster after check-in", async () => {
    const roster = await getFullRoster(TENANT, LOCATION);
    const rosterPassIds = new Set(roster.map((r) => r.passId));
    expect(rosterPassIds.has(MEMBER_1_PASS_ID)).toBe(true);
    expect(rosterPassIds.has(MEMBER_2_PASS_ID)).toBe(true);
  });

  it("[FIXED] group bulk check-in leaves a check_ins audit-trail row per member, same as individual check-in", async () => {
    const rows = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(eq(checkIns.locationId, LOCATION))),
    );
    const passIdsWithCheckIn = new Set(rows.map((r) => r.passId));
    expect(passIdsWithCheckIn.has(MEMBER_1_PASS_ID)).toBe(true);
    expect(passIdsWithCheckIn.has(MEMBER_2_PASS_ID)).toBe(true);
  });

  it("[FIXED] a group bulk check-in that breaches the location's capacity threshold alerts security, same as individual check-in", async () => {
    const rows = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))),
    );
    const capacityAlert = rows.find((r) => {
      const payload = r.payload as { locationId?: string };
      return r.eventType === EVENTS.capacityThresholdReached && payload.locationId === LOCATION;
    });
    // capacityThreshold=1 and 2 members just checked in at this location —
    // groupBulkCheckIn now calls isOverCapacityThreshold() post-commit, same
    // as check-in/consumer.ts.
    expect(capacityAlert).toBeDefined();
  });

  it("contrast: an ordinary individual check-in at its own (uncapped) location correctly reaches the roster", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — RLS-safe
    registerCheckInConsumers(queue);

    await queue.publish(COMMANDS.checkInRecord, {
      type: COMMANDS.checkInRecord,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-solo-checkin-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { passId: SOLO_PASS_ID, gateId: SOLO_GATE },
    });
    await queue.drain();

    const roster = await getFullRoster(TENANT, SOLO_LOCATION);
    // Same getFullRoster()/addToRoster() plumbing the two BUG tests above
    // exercised at the group's LOCATION — it is not globally broken or
    // unconfigured, it simply is never written to by the group-check-in
    // path. Deliberately a DIFFERENT location (SOLO_LOCATION, default
    // capacityThreshold) from the group's, so this check-in isn't rejected
    // by the real, correct capacity enforcement the group already exhausted
    // there (see SOLO_LOCATION's declaration comment above).
    expect(roster.some((r) => r.passId === SOLO_PASS_ID)).toBe(true);
  });
});
