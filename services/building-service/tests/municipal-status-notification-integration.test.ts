/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * building-service's applicant-status notification wiring
 * (modules/applications/consumer.ts submitApplication -> emitMunicipalNotification,
 * shared/cross-events.ts) produces a real notification.send outbox message
 * that a real notification-service consumer resolves against the real
 * municipal.application.submitted template (migration
 * 0044_municipal_templates.sql) and persists on a real delivery row.
 *
 * Same dual-DSN dynamic-import technique as
 * municipal-fee-challan-integration.test.ts in this directory: building's
 * shared/db.ts and notification-service's shared/db.ts each capture
 * process.env.DATABASE_URL synchronously at first import (see
 * packages/db/src/create-tenant-db.ts), so this file flips DATABASE_URL
 * between dynamic imports to give each service its own real connection in
 * one process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

const PGPORT = process.env.BUILDING_TEST_PGPORT ?? "5442";
const BUILDING_DSN = `postgres://building_svc:building_dev_pw@localhost:${PGPORT}/civitas_building`;
const NOTIFICATION_DSN = `postgres://notification_svc:notification_dev_pw@localhost:${PGPORT}/civitas_notification`;

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "dd000003-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let building: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = BUILDING_DSN;
  const buildingDb = await import("../src/shared/db.js");
  const buildingConsumer = await import("../src/modules/applications/consumer.js");
  const queuePkg = await import("@civitasone/queue");
  building = { db: buildingDb.db, sqlClient: buildingDb.sqlClient, queue: new queuePkg.MemoryQueue() };
  buildingConsumer.registerApplicationConsumers(building.queue);

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
  // scoping (see notification-service/tests/municipal-template-integration.test.ts's
  // tenantWrappedQueue helper) -- wrap it onto building's SAME queue so the
  // relayed message reaches it correctly tenant-scoped.
  const rawSubscribe = building.queue.subscribe.bind(building.queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  building.queue.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => notification.runWithTenant(msg.tenantId, () => handler(msg)));
  deliveryConsumer.registerDeliveryConsumers(building.queue);

  await building.queue.start();
});

afterAll(async () => {
  await building.queue.stop();
  await building.sqlClient.end();
  await notification.sqlClient.end();
});

// Was QUARANTINED (task_477fafd4): deliveries/consumer.ts's checkQuota()/
// checkDlt() used to call scopedRead(), which opened a SECOND, nested
// db.transaction() on the same connection pool as the outer send
// transaction -- once concurrent sends reached pool.max (10), every outer
// transaction deadlocked waiting for a connection its own nested checkQuota
// call would never free. Fixed by routing checkQuota/checkDlt onto the
// already-open outer `tx` (see notification-service's channels/quota-guard.ts
// and dlt/guard.ts); un-skipped now that the fix has landed and this test
// passes end-to-end against the fixed notification-service.
describe("building-service -> notification-service applicant status notification -- real DB, no mocks", () => {
  it("submitApplication relays into a real notification-service delivery row on the correct resolved template", async () => {
    const { relayOnce } = await import("@civitasone/outbox");
    const applicationId = randomUUID();

    await building.queue.publish("building.application.create", makeMsg("building.application.create", {
      id: applicationId,
      tenantId: TENANT,
      siteAddress: { line1: "12 MG Road", city: "Test City", pin: "560001" },
      plotArea: 300,
    }));
    await building.queue.drain();

    await building.queue.publish("building.application.submit", makeMsg("building.application.submit", { id: applicationId, tenantId: TENANT }));
    await building.queue.drain();

    // building's REAL outbox now holds TWO pending notification.send messages
    // for this applicationId: createApplication's earlier municipal.fee.due
    // notification (never relayed above -- only building.application.create's
    // COMMAND was drained, not its OUTBOX row) and submitApplication's
    // municipal.application.submitted notification written just now, both in
    // the SAME transaction as their respective status writes -- relay them
    // exactly like the production relay would, in one batch, exactly like a
    // real relay cycle picking up whatever is pending would.
    const relayed = await relayOnce(building.db as never, building.queue, 100, "building-service");
    expect(relayed, "building's outbox must have pending notification.send messages").toBeGreaterThan(0);
    await building.queue.drain();

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
    expect(delivery.recipient).toBe(ACTOR); // building_applications.createdBy, resolved by the consumer's repo.findById lookup
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
  });
});
