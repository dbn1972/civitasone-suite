/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * event-service's applicant-status notification wiring
 * (modules/applications/consumer.ts submitApplication -> emitMunicipalNotification,
 * shared/cross-events.ts) produces a real notification.send outbox message
 * that a real notification-service consumer resolves against the real
 * municipal.application.submitted template and persists on a real delivery
 * row.
 *
 * Same dual-DSN dynamic-import technique as
 * building-service/tests/municipal-status-notification-integration.test.ts:
 * event's shared/db.ts and notification-service's shared/db.ts each capture
 * process.env.DATABASE_URL synchronously at first import (see
 * packages/db/src/create-tenant-db.ts), so this file flips DATABASE_URL
 * between dynamic imports to give each service its own real connection in
 * one process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

/**
 * See municipal-fee-challan-integration.test.ts in this directory for why:
 * event-service's pre-existing real-DB test files (applications.test.ts etc.)
 * leave permanently-unpublished garbage in the SAME _outbox.messages table
 * this file's relayOnce() call scans, which can fill a single bounded
 * relayOnce(limit) batch before ever reaching this test's own message.
 * Draining to completion guarantees it's eventually reached regardless.
 */
async function relayToCompletion(db: unknown, queue: unknown, batchLimit: number, source: string): Promise<number> {
  const { relayOnce } = await import("@civitasone/outbox");
  let total = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await relayOnce(db as never, queue as any, batchLimit, source);
    total += n;
    if (n === 0) return total;
  }
}

const PGPORT = process.env.EVENT_TEST_PGPORT ?? "5444";
const EVENT_DSN = `postgres://event_svc:event_dev_pw@localhost:${PGPORT}/civitas_event`;
const NOTIFICATION_DSN = `postgres://notification_svc:notification_dev_pw@localhost:${PGPORT}/civitas_notification`;

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ff000005-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let event: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = EVENT_DSN;
  const eventDb = await import("../src/shared/db.js");
  const eventConsumer = await import("../src/modules/applications/consumer.js");
  const queuePkg = await import("@civitasone/queue");
  event = { db: eventDb.db, sqlClient: eventDb.sqlClient, queue: new queuePkg.MemoryQueue() };
  eventConsumer.registerApplicationConsumers(event.queue);

  process.env.DATABASE_URL = NOTIFICATION_DSN;
  const notificationDb = await import("../../notification-service/src/shared/db.js");
  const deliveryConsumer = await import("../../notification-service/src/modules/deliveries/consumer.js");
  const deliveriesRepo = await import("../../notification-service/src/modules/deliveries/repo.js");
  const dbPkg = await import("@civitasone/db");
  notification = {
    db: notificationDb.db, sqlClient: notificationDb.sqlClient,
    findByRecipient: deliveriesRepo.findByRecipient,
    runWithTenant: dbPkg.runWithTenant,
  };
  // notification-service's own consumer does not self-wrap for tenant
  // scoping -- wrap it onto event's SAME queue so the relayed message
  // reaches it correctly tenant-scoped.
  const rawSubscribe = event.queue.subscribe.bind(event.queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event.queue.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => notification.runWithTenant(msg.tenantId, () => handler(msg)));
  deliveryConsumer.registerDeliveryConsumers(event.queue);

  await event.queue.start();
});

afterAll(async () => {
  await event.queue.stop();
  await event.sqlClient.end();
  await notification.sqlClient.end();
});

describe("event-service -> notification-service applicant status notification -- real DB, no mocks", () => {
  it("submitApplication relays into a real notification-service delivery row on the correct resolved template", async () => {
    const applicationId = randomUUID();

    await event.queue.publish("event.application.create", makeMsg("event.application.create", {
      id: applicationId,
      tenantId: TENANT,
      organiserName: "Test Organiser",
      organiserPhone: "9999999999",
      eventType: "cultural",
      venueName: "Test Grounds",
      venueAddress: { line1: "1 Test Rd", city: "Test City", pin: "560001" },
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-01T23:00:00.000Z",
      expectedAttendance: 300,
    }));
    await event.queue.drain();

    await event.queue.publish("event.application.submit", makeMsg("event.application.submit", { id: applicationId, tenantId: TENANT }));
    await event.queue.drain();

    // event's REAL outbox now holds TWO pending notification.send messages
    // for this applicationId: createApplication's earlier municipal.fee.due
    // notification (never relayed above -- only event.application.create's
    // COMMAND was drained, not its OUTBOX row) and submitApplication's
    // municipal.application.submitted notification written just now, both in
    // the SAME transaction as their respective status writes -- relay them
    // exactly like the production relay would, in one batch, exactly like a
    // real relay cycle picking up whatever is pending would.
    const relayed = await relayToCompletion(event.db, event.queue, 100, "event-service");
    expect(relayed, "event's outbox must have pending notification.send messages").toBeGreaterThan(0);
    await event.queue.drain();

    // Both notifications share recipientId = applicationId, so select by
    // template rather than trusting deliveries[0] -- the two sends race each
    // other through notification-service's consumer (relayOnce fans them out
    // concurrently), so which one lands the later `createdAt` is not
    // deterministic. Selecting the specific template under test is what
    // proves the applicant-submitted wiring, independent of that race.
    const deliveries = await notification.findByRecipient(TENANT, applicationId, 5);
    expect(deliveries.length, "notification-service's real deliveries consumer must have written delivery rows").toBeGreaterThan(0);
    const delivery = deliveries.find(
      (d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted,
    );
    expect(delivery, "must have a delivery resolved to the municipal.application.submitted template").toBeTruthy();
    expect(delivery.recipient).toBe(ACTOR); // eventApplications.createdBy, resolved via updateStatus's own UPDATE...RETURNING
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
  });
});
