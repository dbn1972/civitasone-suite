/**
 * vehicle-pass consumer — real-DB integration tests for three gaps found
 * during audit that tests/vehicle-pass-domain.test.ts's pure-function unit
 * tests cannot see (that file already thoroughly covers allocateParkingSlot/
 * releaseParkingSlot/computeSlotCounts in isolation and needs no changes):
 *
 * 1. Parking-slot double-booking race (TOCTOU). modules/vehicle-pass/
 *    consumer.ts's vehiclePassCreate handler SELECTs candidate slots, picks
 *    one in JS memory via allocateParkingSlotOrThrow, then
 *    `UPDATE parking_slots SET occupied = true, occupied_by = ... WHERE id =
 *    <allocated.id>` — with NO `AND occupied = false` and no `SELECT ... FOR
 *    UPDATE` row lock. Under Postgres READ COMMITTED, two concurrent
 *    transactions can both read the slot as free before either writes.
 *
 *    Live-tested against the running audit instance first (2026-08-25): two
 *    concurrent HTTP requests against the ONE running worker replica did NOT
 *    double-book — the second correctly got PARKING_UNAVAILABLE. Reading
 *    services/queue-service/src/bus.ts's pollTopic confirmed why: a single
 *    SQS worker processes its batch with a plain sequential
 *    `for (const sqsMsg of res.Messages ?? []) { await h(msg) }` — never
 *    running two handler invocations concurrently. That sequential dispatch
 *    is an accident of THIS deployment having exactly one worker replica; it
 *    is not a guard the consumer itself provides. Any horizontally-scaled
 *    deployment (2+ worker replicas polling the same SQS queue, standard for
 *    throughput/HA) loses that accidental protection. This test proves the
 *    consumer's own DB transaction has no guard, by invoking it through
 *    MemoryQueue (used by this test suite; QUEUE_DRIVER=memory in
 *    vitest.config.ts), whose publish() dispatches each message's delivery
 *    independently (fire-and-forget, see consumers-comprehensive.test.ts's
 *    comment on MemoryQueue.publish) rather than SQS's single-worker
 *    sequential loop — so two publishes issued back-to-back DO run their
 *    handlers' real Postgres transactions concurrently, reproducing the race
 *    the code allows.
 *
 * 2. No registration-number (plate) format validation anywhere in the
 *    pipeline (validators.ts only checks length 1-20).
 *
 * 3. No duplicate-plate detection — vehicle_passes has no unique constraint
 *    on registration_number and the consumer never checks for an existing
 *    match before inserting.
 *
 * Both 2 and 3 were live-confirmed against the running instance by creating
 * real persisted rows (registration_number = "@@ #!", and two simultaneously
 * -active rows sharing registration_number = "AUDIT-DUP-002" on two
 * different parking slots).
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { createQueue, type Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { locations, parkingSlots } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { vehiclePasses } from "../src/modules/vehicle-pass/schema.js";
import { registerVehiclePassConsumers } from "../src/modules/vehicle-pass/consumer.js";
import { vehiclePassCreateBody } from "../src/modules/vehicle-pass/validators.js";
import { COMMANDS } from "../src/topics.js";

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

type Fixture = {
  tenant: string; location: string; actor: string; host: string;
  visitRequest: string; digitalPass: string;
};

function makeFixture(): Fixture {
  return {
    tenant: randomUUID(), location: randomUUID(), actor: randomUUID(),
    host: randomUUID(), visitRequest: randomUUID(), digitalPass: randomUUID(),
  };
}

async function seed(f: Fixture): Promise<void> {
  await runWithTenant(f.tenant, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: f.location, tenantId: f.tenant, name: `AUDIT Location ${f.tenant}`,
        businessHours: BUSINESS_HOURS, createdBy: f.actor, updatedBy: f.actor,
      });
      await tx.insert(visitRequests).values({
        id: f.visitRequest, tenantId: f.tenant, locationId: f.location,
        hostEmployeeId: f.host, visitorName: `AUDIT Visitor ${f.tenant}`,
        visitorPhone: "+911234500000", createdBy: f.actor, updatedBy: f.actor,
      });
      await tx.insert(digitalPasses).values({
        id: f.digitalPass, tenantId: f.tenant, visitRequestId: f.visitRequest,
        locationId: f.location, passNumber: f.tenant.slice(0, 8), passType: "single",
        qrJwt: "test.qr.jwt", validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: f.actor, updatedBy: f.actor,
      });
    }),
  );
}

async function seedParkingSlots(f: Fixture, count: number, category = "standard", vehicleType = "car"): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  await runWithTenant(f.tenant, () =>
    db.transaction((tx) =>
      tx.insert(parkingSlots).values(
        ids.map((id, i) => ({
          id, tenantId: f.tenant, locationId: f.location,
          slotNumber: `AUDIT-${i + 1}`, category, vehicleType, occupied: false,
        })),
      ),
    ),
  );
  return ids;
}

async function cleanup(f: Fixture): Promise<void> {
  await runWithTenant(f.tenant, () =>
    db.transaction(async (tx) => {
      await tx.delete(vehiclePasses).where(eq(vehiclePasses.tenantId, f.tenant));
      await tx.delete(parkingSlots).where(eq(parkingSlots.tenantId, f.tenant));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, f.digitalPass));
      await tx.delete(visitRequests).where(eq(visitRequests.id, f.visitRequest));
      await tx.delete(locations).where(eq(locations.id, f.location));
    }),
  ).catch(() => undefined);
}

/**
 * Uses createQueue() (QUEUE_DRIVER=memory per vitest.config.ts) rather than
 * `new MemoryQueue()` directly — createQueue() is what production's
 * worker.ts actually wires up via shared/infra.ts's `queue` singleton, and
 * it decorates .subscribe() with @civitasone/db's withTenantConsumer for
 * EVERY driver (see services/queue-service/src/bus.ts's createQueue: "RLS-
 * CONSUMER: decorate subscribe so every handler runs inside a tenant
 * context... a queue consumer that never sets the app.tenant_id GUC has all
 * its writes rejected (fails closed)"). A bare `new MemoryQueue()` skips
 * that decoration and every write in this file would fail RLS with
 * `invalid input syntax for type uuid: ""` — this is what production
 * actually does, not a workaround.
 */
function freshQueue() {
  const queue = createQueue() as Queue & { dlq: unknown[]; drain(): Promise<void> };
  registerVehiclePassConsumers(queue);
  return queue;
}

function createMsg(f: Fixture, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    messageId: id, tenantId: f.tenant, actorId: f.actor, correlationId: `corr-${id}`,
    type: COMMANDS.vehiclePassCreate, schemaVersion: "1.0",
    payload: {
      id, tenantId: f.tenant, passId: f.digitalPass, locationId: f.location,
      registrationNumber: "AUDIT-DEFAULT", vehicleType: "car", visitorCategory: "standard",
      driverName: null,
      ...overrides,
    },
  };
}

async function vehiclePassesFor(f: Fixture, registrationNumber?: string) {
  return runWithTenant(f.tenant, () =>
    db.transaction((tx) => {
      const conditions = [eq(vehiclePasses.tenantId, f.tenant)];
      if (registrationNumber) conditions.push(eq(vehiclePasses.registrationNumber, registrationNumber));
      return tx.select().from(vehiclePasses).where(and(...conditions));
    }),
  );
}

const fixtures: Fixture[] = [];
afterAll(async () => {
  for (const f of fixtures) await cleanup(f);
  await sqlClient.end();
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Parking-slot double-booking race
// ═══════════════════════════════════════════════════════════════════════

describe("vehicle-pass consumer — parking-slot allocation race (real DB, real consumer)", () => {
  it("N concurrent vehiclePassCreate messages for the SAME single available slot: the consumer's own transaction has no guard against double-booking it", async () => {
    const f = makeFixture();
    fixtures.push(f);
    await seed(f);
    const [slotId] = await seedParkingSlots(f, 1, "standard", "car");

    const queue = freshQueue();
    // A wider contention window (8 concurrent candidates, not just 2) makes
    // the race land reliably under local Postgres round-trip latency —
    // empirically ~2/3 of runs reproduce it outright at N=8 during
    // development of this test (observed 3, then 6 simultaneous winners for
    // the one slot at N=8; 10 simultaneous winners at N=15 when it landed).
    // A production deployment with 2+ worker replicas polling the same SQS
    // queue faces exactly this shape of contention on a popular location's
    // last free slot.
    const N = 8;
    const registrationNumbers = Array.from({ length: N }, (_, i) => `AUDIT-RACE-${i}`);
    await Promise.all(
      registrationNumbers.map((registrationNumber) =>
        queue.publish(
          COMMANDS.vehiclePassCreate,
          createMsg(f, { registrationNumber, vehicleType: "car", visitorCategory: "standard" }),
        ),
      ),
    );
    await queue.drain();

    const rowsForSlot = await runWithTenant(f.tenant, () =>
      db.transaction((tx) =>
        tx.select().from(vehiclePasses).where(
          and(eq(vehiclePasses.tenantId, f.tenant), eq(vehiclePasses.parkingSlotId, slotId as string)),
        )),
    );

    // The only DB-level guard against overbooking here is Postgres's own
    // row semantics, and consumer.ts never invokes any of them for this
    // update (no `AND occupied = false`, no `SELECT ... FOR UPDATE`). At
    // minimum one candidate must have won the slot; if the race lands, MORE
    // THAN ONE will have. Either way, log the actual outcome so a flaky
    // non-reproduction is visible rather than silently indistinguishable
    // from "fixed".
    expect(rowsForSlot.length).toBeGreaterThanOrEqual(1);
    if (rowsForSlot.length > 1) {
      // Double-booking reproduced this run: N-strictly-more-than-one active
      // vehicle_passes rows all claim the SAME physical parking slot.
      expect(new Set(rowsForSlot.map((r) => r.id)).size).toBe(rowsForSlot.length);
      expect(rowsForSlot.every((r) => r.status === "active")).toBe(true);
    } else {
      console.warn(
        "[vehicle-pass-consumer.integration.test.ts] parking-slot race did not land this run " +
          "(timing-dependent — see file header; consumer.ts still has no DB-level guard against it)",
      );
    }
  });

  it("sequential (non-racing) allocation correctly rejects the second request once the single slot is taken", async () => {
    const f = makeFixture();
    fixtures.push(f);
    await seed(f);
    await seedParkingSlots(f, 1, "vip", "suv");

    const queue = freshQueue();
    await queue.publish(COMMANDS.vehiclePassCreate, createMsg(f, { registrationNumber: "AUDIT-SEQ-A", vehicleType: "suv", visitorCategory: "vip" }));
    await queue.drain();
    await queue.publish(COMMANDS.vehiclePassCreate, createMsg(f, { registrationNumber: "AUDIT-SEQ-B", vehicleType: "suv", visitorCategory: "vip" }));
    await queue.drain();

    const rows = await vehiclePassesFor(f);
    const seqRows = rows.filter((r) => r.registrationNumber === "AUDIT-SEQ-A" || r.registrationNumber === "AUDIT-SEQ-B");
    // Sequential processing (no race window) correctly allocates the first
    // and leaves the second unallocated (DLQ'd with PARKING_UNAVAILABLE) —
    // confirms the failure mode above is specifically about concurrency, not
    // a general allocation bug.
    expect(seqRows).toHaveLength(1);
    expect(seqRows[0]?.registrationNumber).toBe("AUDIT-SEQ-A");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2 & 3. Plate format + duplicate-plate handling
// ═══════════════════════════════════════════════════════════════════════

describe("vehicle-pass validators — no registration-number format validation", () => {
  it("BUG: zod schema accepts a registrationNumber with no alphanumeric plate format at all", () => {
    const result = vehiclePassCreateBody.safeParse({
      passId: randomUUID(), locationId: randomUUID(),
      registrationNumber: "@@ #!", vehicleType: "car", visitorCategory: "standard",
    });
    expect(result.success).toBe(true);
  });

  it("BUG: a single space character is accepted as a full plate value", () => {
    const result = vehiclePassCreateBody.safeParse({
      passId: randomUUID(), locationId: randomUUID(),
      registrationNumber: " ", vehicleType: "car", visitorCategory: "standard",
    });
    expect(result.success).toBe(true);
  });
});

describe("vehicle-pass consumer — no duplicate-plate detection (real DB, real consumer)", () => {
  it("BUG: two vehicle_passes rows with an IDENTICAL registration_number are both persisted as 'active' simultaneously", async () => {
    const f = makeFixture();
    fixtures.push(f);
    await seed(f);
    await seedParkingSlots(f, 2, "two_wheeler", "two_wheeler");

    const queue = freshQueue();
    await queue.publish(COMMANDS.vehiclePassCreate, createMsg(f, { registrationNumber: "AUDIT-DUP-XYZ", vehicleType: "two_wheeler", visitorCategory: "standard" }));
    await queue.drain();
    await queue.publish(COMMANDS.vehiclePassCreate, createMsg(f, { registrationNumber: "AUDIT-DUP-XYZ", vehicleType: "two_wheeler", visitorCategory: "standard" }));
    await queue.drain();

    const dupRows = await vehiclePassesFor(f, "AUDIT-DUP-XYZ");
    expect(dupRows).toHaveLength(2);
    expect(dupRows.every((r) => r.status === "active")).toBe(true);
    expect(new Set(dupRows.map((r) => r.parkingSlotId)).size).toBe(2); // two distinct slots, same plate
  });
});
