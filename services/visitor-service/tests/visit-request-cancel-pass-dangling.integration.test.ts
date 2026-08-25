/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — cancelling an approved visit
 * request never revokes its digital pass or vehicle pass: both dangle
 * fully active, and the pass can still be used to check in.
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
import { registerVisitRequestConsumers } from "../src/modules/visit-request/consumer.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { isRevoked } from "../src/modules/digital-pass/revocation-store.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { vehiclePasses } from "../src/modules/vehicle-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
const PASS_ID = randomUUID();
const VEHICLE_PASS_ID = randomUUID();

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
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("visit-request cancel -> dangling digital pass / vehicle pass", () => {
  it("sanity: cancelling the visit request does correctly update its own status", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — RLS-safe
    registerVisitRequestConsumers(queue);

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

  it.fails("[BUG] the digital pass should be revoked once its parent visit request is cancelled", async () => {
    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID))),
    );
    expect(pass?.status).toBe("revoked");
    expect(pass?.revoked).toBe(true);
  });

  it.fails("[BUG] the vehicle pass tied to a cancelled visit should no longer be active", async () => {
    const [vp] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(vehiclePasses).where(eq(vehiclePasses.id, VEHICLE_PASS_ID))),
    );
    expect(vp?.status).not.toBe("active");
  });

  it.fails("[BUG] gate-side offline QR verification should also start rejecting the cancelled visit's pass", async () => {
    // isRevoked() backs modules/check-in/domain.ts's QR-verification path
    // (Property 10) — the same Redis set gate-sync ships to offline
    // terminals. Cancel never calls addToRevokedSet, so this stays false.
    expect(await isRevoked(TENANT, PASS_ID)).toBe(true);
  });

  it("BUG: the cancelled visit's digital pass can still be used to check in at the gate", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — RLS-safe
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
    // The exploit fully succeeds: check-in/consumer.ts's domain state
    // machine only looks at the pass's OWN status column ('active' ->
    // 'checked_in' is the normal, allowed transition) — it has no
    // awareness whatsoever of the parent visit request's cancellation.
    expect(pass?.status).toBe("checked_in");
    expect(checkInRow).toBeDefined();
  });
});
