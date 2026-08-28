/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH), FIXED 2026-08-27 (deep-verify)
 * — cancelling an approved visit request never revoked its digital pass
 * or vehicle pass: both dangled fully active, and the pass could still
 * be used to check in. `modules/visit-request/consumer.ts`'s
 * `visitRequestCancel` handler now looks up any active digital pass for
 * the cancelled request post-commit, revokes it
 * (`digital-pass/commands.ts#passRevoke`) and releases its parking slot
 * if one was allocated (`vehicle-pass/commands.ts#releaseParkingIfAllocated`,
 * new in this fix) — same best-effort-after-commit shape as the
 * roster-removal / pass-generate patterns already used elsewhere in this
 * service. The `it.fails(...)` cases below are now real, passing
 * assertions; the final exploit case is inverted to prove the exploit no
 * longer works.
 *
 * `modules/visit-request/domain.ts`'s state machine allows
 * `approved -> cancelled` directly (`ALLOWED_TRANSITIONS.approved =
 * ["cancelled", "no_show"]`) — i.e. a visit can be cancelled AFTER its
 * digital pass (and any vehicle pass, which is created against an
 * existing `passId`) already exist. `modules/visit-request/consumer.ts`'s
 * `visitRequestCancel` handler (and `visitRequestReject`) only ever
 * updates the `visit_requests` row itself — `status`, `updatedAt` — and
 * outboxes `visitRequestCancelled`. A repo-wide grep confirms nothing,
 * anywhere in this service, ever `queue.subscribe()`s to
 * `EVENTS.visitRequestCancelled` (or `visitRequestRejected` /
 * `visitRequestAutoRejected`). `COMMANDS.passRevoke` — the ONLY thing that
 * ever revokes a digital pass (`modules/digital-pass/consumer.ts`) — is
 * published from exactly one place in the whole codebase:
 * `modules/digital-pass/commands.ts#passRevoke`, called only from the
 * explicit, manual `POST /v1/visitor/digital-passes/:id/revoke` admin
 * route. Nothing wires a visit-request cancellation to it.
 *
 * Tellingly, the codebase already has PRECEDENT for exactly this kind of
 * cascade on a sibling terminal transition: `modules/visit-request/
 * no-show-worker.ts`'s auto no-show path (`approved -> no_show`) DOES
 * release the vehicle pass's parking slot (`COMMANDS.parkingSlotRelease`)
 * as part of the same atomic transition. The manual cancel/reject paths
 * never picked up the equivalent pattern for either the parking slot OR —
 * far more seriously — the digital pass itself, on ANY terminal
 * transition (cancel, reject, or no-show).
 *
 * Net effect proven live below: a visitor whose visit is cancelled keeps a
 * fully valid, scannable QR pass and an active vehicle pass, and can walk
 * up to a gate and check in completely normally — `check-in/consumer.ts`
 * has no notion of the parent visit request's status at all, only the
 * pass's own `status` column and the independent Redis revocation set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
// The real shared queue singleton, NOT a fresh local MemoryQueue, for
// the cascade test below -- passRevoke and releaseParkingIfAllocated
// (via their own commands.ts) publish on this exact singleton, same as
// every command publisher in this service; worker.ts registers every
// module's consumer on it for the same reason. The later checkInRecord
// test still uses its own fresh local queue -- it only needs to read
// already-persisted DB state via its own consumer, not this cascade.
import { queue as sharedQueue } from "../src/shared/infra.js";
import { registerVisitRequestConsumers } from "../src/modules/visit-request/consumer.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { registerDigitalPassConsumers } from "../src/modules/digital-pass/consumer.js";
import { registerVehiclePassConsumers } from "../src/modules/vehicle-pass/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { isRevoked } from "../src/modules/digital-pass/revocation-store.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { vehiclePasses } from "../src/modules/vehicle-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { parkingSlots } from "../src/modules/location/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
const PASS_ID = randomUUID();
const VEHICLE_PASS_ID = randomUUID();
const PARKING_SLOT_ID = randomUUID();

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Cancel-Dangling Test Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "Cancel-Dangling Test Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      // Realistic scenario: the vehicle pass has an actually-allocated
      // parking slot, so "cancellation should release it" has something
      // real to assert on (the original fixture left parkingSlotId unset).
      await tx.insert(parkingSlots).values({
        id: PARKING_SLOT_ID, tenantId: TENANT, locationId: LOCATION,
        slotNumber: "CXD-1", category: "standard", vehicleType: "car",
        occupied: true, occupiedBy: VEHICLE_PASS_ID,
      });
      // Starts APPROVED — approved -> cancelled is a legal transition, and
      // is exactly the real-world case where a pass/vehicle-pass already
      // exist by the time the visit gets cancelled.
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Cancel-Dangling Visitor", visitorPhone: "+919900044455",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
        locationId: LOCATION, passNumber: "CXD" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "active", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(vehiclePasses).values({
        id: VEHICLE_PASS_ID, tenantId: TENANT, passId: PASS_ID, locationId: LOCATION,
        registrationNumber: "AUDIT-CXD-01", vehicleType: "car", status: "active",
        parkingSlotId: PARKING_SLOT_ID,
        driverName: "AUDIT Cancel-Dangling Visitor", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.passId, PASS_ID));
      await tx.delete(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(parkingSlots).where(eq(parkingSlots.id, PARKING_SLOT_ID));
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

const CHECKED_OUT_VISIT_REQUEST_ID = randomUUID();
const CHECKED_OUT_PASS_ID = randomUUID();

beforeAll(async () => {
  // Second fixture, in "checked_out" status -- the review-flagged gap:
  // check-in/domain.ts#checkIn() allows checked_out -> checked_in
  // re-entry, so a pass that already completed one visit and is sitting
  // checked_out is exactly as re-usable as an active/checked_in one and
  // must be revoked on cancellation too. The main fixture above never
  // exercises this status.
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(visitRequests).values({
        id: CHECKED_OUT_VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Checked-Out-Then-Cancel Visitor", visitorPhone: "+919900044477",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: CHECKED_OUT_PASS_ID, tenantId: TENANT, visitRequestId: CHECKED_OUT_VISIT_REQUEST_ID,
        locationId: LOCATION, passNumber: "CXO" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "checked_out", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, CHECKED_OUT_PASS_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, CHECKED_OUT_VISIT_REQUEST_ID));
    }),
  );
});

describe("visit-request cancel -> dangling digital pass / vehicle pass", () => {
  it("sanity: cancelling the visit request does correctly update its own status", async () => {
    const queue = sharedQueue;
    registerVisitRequestConsumers(queue);
    registerDigitalPassConsumers(queue);
    registerVehiclePassConsumers(queue);

    await queue.publish(COMMANDS.visitRequestCancel, {
      type: COMMANDS.visitRequestCancel,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-cancel-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id: VISIT_REQUEST_ID },
    });
    await queue.drain();

    const [vr] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID))),
    );
    expect(vr?.status).toBe("cancelled");
  });

  it("FIXED: the digital pass is revoked once its parent visit request is cancelled", async () => {
    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID))),
    );
    expect(pass?.status).toBe("revoked");
    expect(pass?.revoked).toBe(true);
  });

  it("FIXED: the vehicle pass tied to a cancelled visit is no longer active (its parking slot was released)", async () => {
    const [vp] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID))),
    );
    const [slot] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(parkingSlots).where(eq(parkingSlots.id, PARKING_SLOT_ID))),
    );
    expect(vp?.status).toBe("checked_out");
    expect(slot?.occupied).toBe(false);
    expect(slot?.occupiedBy).toBeNull();
  });

  it("FIXED: gate-side offline QR verification now rejects the cancelled visit's pass", async () => {
    // isRevoked() backs modules/check-in/domain.ts's QR-verification path
    // (Property 10) — the same Redis set gate-sync ships to offline
    // terminals. Cancel never calls addToRevokedSet, so this stays false.
    expect(await isRevoked(TENANT, PASS_ID)).toBe(true);
  });

  it("FIXED: the cancelled visit's digital pass can no longer be used to check in at the gate", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated -- RLS-safe
    registerCheckInConsumers(queue);

    await queue.publish(COMMANDS.checkInRecord, {
      type: COMMANDS.checkInRecord,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-checkin-after-cancel-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { passId: PASS_ID, gateId: GATE },
    });
    await queue.drain();

    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID))),
    );
    const [checkInRow] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(eq(checkIns.passId, PASS_ID))),
    );
    // check-in/domain.ts#checkIn() only allows the transition from
    // "active"/"issued" (or "checked_out" for re-entry) -- "revoked" now
    // hits its final `throw new DomainError("INVALID_TRANSITION", ...)`,
    // which rolls back the whole consumer transaction: no check-in row is
    // ever inserted and the pass's status is left untouched at "revoked".
    expect(pass?.status).toBe("revoked");
    expect(checkInRow).toBeUndefined();
  });

  it("FIXED: a pass already checked_out (re-enterable, per check-in/domain.ts) is still revoked on cancellation", async () => {
    const queue = sharedQueue;
    registerVisitRequestConsumers(queue);
    registerDigitalPassConsumers(queue);
    registerVehiclePassConsumers(queue);

    await queue.publish(COMMANDS.visitRequestCancel, {
      type: COMMANDS.visitRequestCancel,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-cancel-checked-out-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: { id: CHECKED_OUT_VISIT_REQUEST_ID },
    });
    await queue.drain();

    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, CHECKED_OUT_PASS_ID))),
    );
    expect(pass?.status).toBe("revoked");
    expect(pass?.revoked).toBe(true);
  });
});
