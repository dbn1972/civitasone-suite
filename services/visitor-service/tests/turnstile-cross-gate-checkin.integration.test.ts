/**
 * CROSS-MODULE INTEGRATION FINDING — device/gate binding enforcement now
 * covers the real, persisted check-in record and evacuation roster, not
 * just the route boundary (Fix 5).
 *
 * A companion PR (#700, security/access-control cluster) already proved
 * the entry point of this gap in isolation: `turnstile-gate-binding.test.ts`
 * shows `POST /v1/visitor/turnstiles/passage` used to take `gateId` from
 * the client-supplied body and never compare it to the authenticated
 * device's own `deviceContext.gateId` (bound at auth time from
 * `devices.gate_id` — `modules/device-registry/device-auth.ts`).
 *
 * This test answers the question that was left open: what happens once a
 * mismatched command reaches the real system? It registers the REAL
 * `turnstile-control` and `check-in` consumers on the same queue, drives a
 * `passageRecord` command exactly as the route would have published it
 * PRE-FIX — claiming a gate the device has no relationship to — through the
 * real transactional-outbox relay (`relayOnce`, the same helper
 * `src/worker.ts` runs on an interval in production) into the real
 * `checkInRecord` consumer, against the live Postgres DB.
 *
 * The fix (turnstile-control/consumer.ts's passageRecord handler): before
 * doing anything else, it now resolves the claimed device's ACTUAL bound
 * gate (device-registry/repo.js#getDeviceById, keyed by msg.actorId =
 * deviceId) and rejects outright — no passage_events row, no downstream
 * checkInRecord enqueue, no anti-passback/tailgating processing — when
 * `device.gateId !== payload.gateId`. This is defense in depth alongside
 * the route-level check (turnstile-control/routes.ts): this test publishes
 * directly to the queue, bypassing the route entirely, to prove the
 * consumer independently closes the gap even if something else were to
 * publish a mismatched command.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { relayOnce } from "../src/shared/outbox.js";
import { registerTurnstileControlConsumers } from "../src/modules/turnstile-control/consumer.js";
import { registerCheckInConsumers } from "../src/modules/check-in/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { checkIns } from "../src/modules/check-in/schema.js";
import { passageEvents } from "../src/modules/turnstile-control/schema.js";
import { getFullRoster } from "../src/modules/evacuation/roster.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const GATE_A = randomUUID(); // the device's REAL, registered/bound gate
const GATE_B = randomUUID(); // an unrelated gate in the same tenant/location
const DEVICE_ID = randomUUID();
const ACTOR = randomUUID();
const HOST = randomUUID();
const VISIT_REQUEST_ID = randomUUID();
const PASS_ID = randomUUID();
const CORR = `corr-turnstile-${randomUUID()}`;

// A second, independent visitor/pass so the "should be rejected" test below
// is self-contained rather than depending on the mutated state left behind
// by the first test.
const VISIT_REQUEST_ID_2 = randomUUID();
const PASS_ID_2 = randomUUID();
const CORR_2 = `corr-turnstile-2-${randomUUID()}`;

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Turnstile Cross-Gate Test Loc",
        businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values([
        { id: GATE_A, tenantId: TENANT, locationId: LOCATION, name: "Gate A (device's real gate)", createdBy: ACTOR, updatedBy: ACTOR },
        { id: GATE_B, tenantId: TENANT, locationId: LOCATION, name: "Gate B (claimed, unrelated)", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
      // The device's device-registry row — its true, registered binding is
      // Gate A. device-auth.ts would bind `deviceContext.gateId = GATE_A`
      // for every request this device makes.
      await tx.insert(devices).values({
        id: DEVICE_ID, tenantId: TENANT, deviceType: "turnstile", name: "AUDIT Turnstile @ Gate A",
        serialNumber: "AUDIT-TRN-" + randomUUID().slice(0, 8), locationId: LOCATION, gateId: GATE_A,
        authType: "mtls", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Cross-Gate Visitor", visitorPhone: "+919900033344",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
        locationId: LOCATION, passNumber: "TCG" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "active", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: VISIT_REQUEST_ID_2, tenantId: TENANT, locationId: LOCATION,
        hostEmployeeId: HOST, status: "approved",
        visitorName: "AUDIT Cross-Gate Visitor 2", visitorPhone: "+919900033355",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: PASS_ID_2, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID_2,
        locationId: LOCATION, passNumber: "TCG" + Math.floor(Math.random() * 1e6),
        passType: "single", status: "active", qrJwt: "audit.fixture.jwt",
        validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(checkIns).where(eq(checkIns.passId, PASS_ID));
      await tx.delete(checkIns).where(eq(checkIns.passId, PASS_ID_2));
      await tx.delete(passageEvents).where(eq(passageEvents.passId, PASS_ID));
      await tx.delete(passageEvents).where(eq(passageEvents.passId, PASS_ID_2));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, PASS_ID));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, PASS_ID_2));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_ID_2));
      await tx.delete(devices).where(eq(devices.id, DEVICE_ID));
      await tx.delete(gates).where(eq(gates.locationId, LOCATION));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("turnstile passage -> check-in — device/gate binding enforced end-to-end (Fix 5)", () => {
  it("a device bound to Gate A is rejected claiming an unrelated Gate B — no passage_event, no check-in", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — see file docstring
    registerTurnstileControlConsumers(queue);
    registerCheckInConsumers(queue);

    // Exactly what the route WOULD publish if its own gate-binding check
    // were somehow bypassed: `actorId` is the authenticated device's id,
    // `gateId` is a gate the device has no relationship to.
    await queue.publish(COMMANDS.passageRecord, {
      type: COMMANDS.passageRecord,
      tenantId: TENANT,
      actorId: DEVICE_ID,
      correlationId: CORR,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        passId: PASS_ID,
        gateId: GATE_B,
        direction: "in",
        passageCount: 1,
        eventTimestamp: new Date().toISOString(),
        offlineRecorded: false,
      },
    });
    await queue.drain(); // turnstile-control consumer: gate-binding check rejects, nothing enqueued

    // Drain the transactional outbox exactly as src/worker.ts's startRelay
    // does on its interval in production. The rejection path still writes
    // an audit-trail outbox row (outcome: "rejected") — that's the one
    // thing relayOnce finds and relays; it is NOT a checkInRecord command,
    // which is the substantive property the assertions below confirm.
    await relayOnce(db, queue);
    await queue.drain();

    const [checkInRow] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(and(eq(checkIns.passId, PASS_ID), eq(checkIns.gateId, GATE_B)))),
    );
    const [passageEventRow] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(passageEvents).where(eq(passageEvents.passId, PASS_ID))),
    );
    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID))),
    );
    const roster = await getFullRoster(TENANT, LOCATION);
    const rosterEntry = roster.find((r) => r.passId === PASS_ID);

    // Fixed: the consumer's gate-binding check rejects the command outright
    // — no passage_event row, no check-in, the visitor's pass stays
    // untouched, and the evacuation roster does not attribute them to the
    // wrong (or any) gate.
    expect(passageEventRow).toBeUndefined();
    expect(checkInRow).toBeUndefined();
    expect(pass?.status).not.toBe("checked_in");
    expect(rosterEntry).toBeUndefined();
  }, 15000);

  it("a passage event whose claimed gate does not match the device's registered gate is rejected, not recorded as a check-in", async () => {
    // Independent fixture (PASS_ID_2) so this assertion does not merely
    // restate the previous test's already-mutated state.
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — see file docstring
    registerTurnstileControlConsumers(queue);
    registerCheckInConsumers(queue);

    await queue.publish(COMMANDS.passageRecord, {
      type: COMMANDS.passageRecord,
      tenantId: TENANT,
      actorId: DEVICE_ID, // still the device truly bound to Gate A
      correlationId: CORR_2,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        passId: PASS_ID_2,
        gateId: GATE_B, // claims the unrelated gate again
        direction: "in",
        passageCount: 1,
        eventTimestamp: new Date().toISOString(),
        offlineRecorded: false,
      },
    });
    await queue.drain();
    await relayOnce(db, queue);
    await queue.drain();

    const [pass2] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID_2))),
    );
    // Fixed: a device only ever produces passage/check-in events for the
    // gate it is actually registered to (Gate A) — a claim of Gate B is
    // rejected outright, leaving the pass untouched.
    expect(pass2?.status).not.toBe("checked_in");
  }, 15000);

  it("sanity check: the SAME device correctly claiming its OWN Gate A still produces a real check-in", async () => {
    const queue = createQueue() as MemoryQueue;
    registerTurnstileControlConsumers(queue);
    registerCheckInConsumers(queue);

    await queue.publish(COMMANDS.passageRecord, {
      type: COMMANDS.passageRecord,
      tenantId: TENANT,
      actorId: DEVICE_ID,
      correlationId: `corr-turnstile-sanity-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: {
        id: randomUUID(),
        passId: PASS_ID_2,
        gateId: GATE_A, // the device's REAL bound gate
        direction: "in",
        passageCount: 1,
        eventTimestamp: new Date().toISOString(),
        offlineRecorded: false,
      },
    });
    await queue.drain();
    await relayOnce(db, queue);
    await queue.drain();

    const [pass2] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID_2))),
    );
    // Confirms Fix 5 rejects only the MISMATCH — legitimate same-gate
    // passage still flows through to a real check-in exactly as before.
    expect(pass2?.status).toBe("checked_in");
  }, 15000);
});
