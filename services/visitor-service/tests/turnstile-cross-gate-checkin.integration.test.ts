/**
 * CROSS-MODULE INTEGRATION FINDING (HIGH) — a turnstile device's gate
 * binding is unenforced ALL THE WAY into a real, persisted check-in record
 * and the evacuation roster, not just at the route boundary.
 *
 * A companion PR (#700, security/access-control cluster) already proved
 * the entry point of this gap in isolation: `turnstile-gate-binding.test.ts`
 * shows `POST /v1/visitor/turnstiles/passage` takes `gateId` from the
 * client-supplied body and never compares it to the authenticated device's
 * own `deviceContext.gateId` (bound at auth time from `devices.gate_id` —
 * `modules/device-registry/device-auth.ts`), using a fully mocked
 * `publishPassageRecord` that never touches a real consumer or the DB.
 *
 * This test answers the question that leaves open: what actually happens
 * once that mismatched command reaches the real system? It registers the
 * REAL `turnstile-control` and `check-in` consumers on the same queue,
 * drives a `passageRecord` command exactly as the (unenforced) route would
 * publish it — claiming a gate the device has no relationship to — through
 * the real transactional-outbox relay (`relayOnce`, the same helper
 * `src/worker.ts` runs on an interval in production) into the real
 * `checkInRecord` consumer, against the live Postgres DB:
 *
 *   turnstile-control/consumer.ts (passageRecord):
 *     INSERT passage_events (gate_id = <claimed gate>)
 *     -> enqueue COMMANDS.checkInRecord (gate_id = <claimed gate>)   [consumer.ts:262-278]
 *   check-in/consumer.ts (checkInRecord):
 *     INSERT check_ins (gate_id = <claimed gate>)                   [consumer.ts:110-121]
 *     UPDATE digital_passes SET status = 'checked_in'
 *     addToRoster(..., lastKnownGate: <claimed gate>)               [consumer.ts:357]
 *
 * Neither consumer, nor the route, ever queries `devices` or compares the
 * claimed gate to anything — the fabricated gate flows straight through
 * into the check-in audit trail, the visitor's pass state, AND the
 * real-time evacuation roster used for life-safety accounting.
 *
 * Adjacent, non-duplicate finding: PR #702 (lifecycle cluster) separately
 * documents that `COMMANDS.checkInRecord` never re-validates a pass's
 * gate/location/area scope for ANY caller, including the direct
 * `POST /v1/visitor/check-ins` HTTP route under a broad "employee" role
 * with no device involved at all (`check-in-bypasses-gate-scope.test.ts`).
 * That is a different specific mechanism and threat model — general
 * scope-check bypass vs. this test's device-authentication/gate-binding
 * bypass — that happens to share the same root symptom (checkInRecord
 * trusts its `gateId` unconditionally).
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

// A second, independent visitor/pass so the "should have been rejected"
// test below is self-contained rather than depending on the mutated state
// left behind by the first test.
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

describe("turnstile passage -> check-in — device/gate binding unenforced end-to-end", () => {
  it("BUG: a device bound to Gate A fabricates a real, persisted check-in at unrelated Gate B", async () => {
    const queue = createQueue() as MemoryQueue; // withTenantConsumer-decorated — see file docstring
    registerTurnstileControlConsumers(queue);
    registerCheckInConsumers(queue);

    // Exactly what the (unenforced) route publishes: `actorId` is the
    // authenticated device's id, `gateId` is whatever the client body
    // claims — here, a gate the device has no relationship to.
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
    await queue.drain(); // turnstile-control consumer: passage_events row + outbox checkInRecord

    // Drain the transactional outbox exactly as src/worker.ts's startRelay
    // does on its interval in production — this is the real hop from
    // "turnstile-control enqueued a command" to "check-in consumer runs it".
    const relayed = await relayOnce(db, queue);
    expect(relayed).toBeGreaterThanOrEqual(1);
    await queue.drain(); // check-in consumer: check_ins row + pass status + roster

    const [checkInRow] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(checkIns).where(and(eq(checkIns.passId, PASS_ID), eq(checkIns.gateId, GATE_B)))),
    );
    const [pass] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, PASS_ID))),
    );
    const roster = await getFullRoster(TENANT, LOCATION);
    const rosterEntry = roster.find((r) => r.passId === PASS_ID);

    // The exploit fully succeeds: a genuine, tenant-scoped, DB-durable
    // check-in exists at a gate this device was never bound to, the
    // visitor's pass is live-marked checked_in, and the real-time
    // evacuation roster now attributes them to the WRONG physical gate.
    expect(checkInRow).toBeDefined();
    expect(pass?.status).toBe("checked_in");
    expect(rosterEntry?.lastKnownGate).toBe(GATE_B);
  });

  it.fails("[BUG] a passage event whose claimed gate does not match the device's registered gate should be rejected, not recorded as a check-in", async () => {
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
    // Correct behavior: a device should only ever be able to produce
    // passage/check-in events for the gate it is actually registered to
    // (Gate A) — a claim of Gate B should be rejected outright, leaving
    // the pass untouched. It is not rejected: the pass transitions to
    // 'checked_in' exactly as it would for a legitimate Gate-A scan.
    expect(pass2?.status).not.toBe("checked_in");
  });
});
