/**
 * F64 regression (UAT bundle 8, found by the W7 DB test): silent data loss
 * in POST /v1/visitor/group-visits/:id/bulk-checkin.
 *
 * gateId was optional at the API, the route answered 202, and the
 * groupBulkCheckIn consumer wrote `gateId ?? ""` into check_ins.gate_id, a
 * NOT NULL uuid FK to visitor.gates. Postgres rejected "" ("invalid input
 * syntax for type uuid"), the whole transaction rolled back, the message was
 * retried as if the failure were transient and finally dead-lettered with a
 * raw Postgres error. No check_ins row was ever written and no member was
 * checked in.
 *
 * The route now requires gateId (400, see all-routes.test.ts). This file
 * covers the consumer against a real Postgres: a message without a gate, or
 * with a gate unknown to the tenant, is rejected as a NonRetryableError with
 * a clear reason and writes nothing; a valid gate writes one check_ins row
 * per member carrying that gate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { registerGroupVisitConsumers } from "../src/modules/group-visit/consumer.js";
import { COMMANDS } from "../src/topics.js";
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
const VISIT_REQUEST_ID = randomUUID();
const GROUP_VISIT_ID = randomUUID();
const PASS_1 = randomUUID();
const PASS_2 = randomUUID();

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

function freshPass(id: string) {
  return {
    id, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID, locationId: LOCATION,
    passNumber: "F64" + Math.floor(Math.random() * 1e6), passType: "single" as const,
    status: "active" as const, qrJwt: "f64.fixture.jwt",
    validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
    createdBy: ACTOR, updatedBy: ACTOR,
  };
}

async function bulkCheckIn(gateId: string | null): Promise<MemoryQueue> {
  const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — RLS-safe
  registerGroupVisitConsumers(queue);
  await queue.publish(COMMANDS.groupBulkCheckIn, {
    type: COMMANDS.groupBulkCheckIn,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-f64-${randomUUID()}`,
    schemaVersion: "1.0",
    payload: { groupVisitId: GROUP_VISIT_ID, tenantId: TENANT, actualHeadcount: 2, gateId },
  });
  await queue.drain();
  return queue;
}

async function groupCheckInRows() {
  return runWithTenant(TENANT, () =>
    scopedRead((tx) => tx.select().from(checkIns).where(
      and(eq(checkIns.tenantId, TENANT), eq(checkIns.locationId, LOCATION)),
    )),
  );
}

async function passStatuses(): Promise<string[]> {
  const rows = await runWithTenant(TENANT, () =>
    scopedRead((tx) => tx.select().from(digitalPasses).where(
      and(eq(digitalPasses.tenantId, TENANT), eq(digitalPasses.visitRequestId, VISIT_REQUEST_ID)),
    )),
  );
  return rows.map((r) => r.status);
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "F64 Bulk Check-in Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "F64 Main Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "pre_approved",
        visitorName: "F64 Group Lead", visitorPhone: "+919900064064",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(groupVisits).values({
        id: GROUP_VISIT_ID, tenantId: TENANT, groupName: "F64 Group",
        memberCount: 2, purpose: "F64 regression",
        visitRequestId: VISIT_REQUEST_ID, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values([freshPass(PASS_1), freshPass(PASS_2)]);
      await tx.insert(groupMembers).values([
        { id: randomUUID(), tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, memberName: "F64 Member One", passId: PASS_1, blacklisted: false, createdBy: ACTOR },
        { id: randomUUID(), tenantId: TENANT, groupVisitId: GROUP_VISIT_ID, memberName: "F64 Member Two", passId: PASS_2, blacklisted: false, createdBy: ACTOR },
      ]);
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.locationId, LOCATION));
      await tx.delete(groupMembers).where(eq(groupMembers.groupVisitId, GROUP_VISIT_ID));
      await tx.delete(groupVisits).where(eq(groupVisits.id, GROUP_VISIT_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.visitRequestId, VISIT_REQUEST_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

// Ordered: the two rejection cases must leave the passes untouched so the
// final valid-gate case can check them in.
describe("F64 group bulk check-in requires a real gate", () => {
  it("missing gateId is dead-lettered with a clear reason and writes nothing", async () => {
    const queue = await bulkCheckIn(null);

    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]!.error).toMatch(/gateId is required/);
    expect(await groupCheckInRows()).toHaveLength(0);
    expect(await passStatuses()).toEqual(["active", "active"]);
  });

  it("a gate unknown to the tenant is dead-lettered with a clear reason and writes nothing", async () => {
    const unknownGate = randomUUID();
    const queue = await bulkCheckIn(unknownGate);

    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]!.error).toMatch(new RegExp(`gate '${unknownGate}' not found`));
    expect(await groupCheckInRows()).toHaveLength(0);
    expect(await passStatuses()).toEqual(["active", "active"]);
  });

  it("a valid gate writes one check_ins row per member at that gate", async () => {
    const queue = await bulkCheckIn(GATE);

    expect(queue.dlq).toHaveLength(0);
    const rows = await groupCheckInRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.passId))).toEqual(new Set([PASS_1, PASS_2]));
    expect(rows.every((r) => r.gateId === GATE && r.direction === "in" && r.verificationMethod === "bulk")).toBe(true);
    expect(await passStatuses()).toEqual(["checked_in", "checked_in"]);
  });
});
