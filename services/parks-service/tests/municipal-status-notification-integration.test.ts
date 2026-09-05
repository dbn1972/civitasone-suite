/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * parks-service's citizen-notification wiring (modules/complaints/consumer.ts
 * CREATE_COMPLAINT + modules/tree_requests/consumer.ts APPROVE_TREE_REQUEST
 * -> emitMunicipalNotification, shared/cross-events.ts) produces a real
 * notification.send outbox message that a real notification-service
 * consumer resolves against real templates (migration
 * 0044_municipal_templates.sql / 0003_system_templates.sql) and persists on
 * real delivery rows.
 *
 * parks-service has no fee/amount concept anywhere in its schema (see
 * shared/cross-events.ts's header) — there is no finance-challan
 * counterpart to this file, unlike building-service's pair of
 * municipal-fee-challan-integration.test.ts / this-named test.
 *
 * Same dual-DSN dynamic-import technique as building-service's
 * municipal-status-notification-integration.test.ts in this directory:
 * parks's shared/db.ts and notification-service's shared/db.ts each capture
 * process.env.DATABASE_URL synchronously at first import (see
 * packages/db/src/create-tenant-db.ts), so this file flips DATABASE_URL
 * between dynamic imports to give each service its own real connection in
 * one process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

const PGPORT = process.env.PARKS_TEST_PGPORT ?? "5446";
const PARKS_DSN = `postgres://parks_svc:parks_dev_pw@localhost:${PGPORT}/civitas_parks`;
const NOTIFICATION_DSN = `postgres://notification_svc:notification_dev_pw@localhost:${PGPORT}/civitas_notification`;

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ee000004-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parks: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = PARKS_DSN;
  const parksDb = await import("../src/shared/db.js");
  const complaintsConsumer = await import("../src/modules/complaints/consumer.js");
  const treeRequestsConsumer = await import("../src/modules/tree_requests/consumer.js");
  const queuePkg = await import("@civitasone/queue");
  parks = { db: parksDb.db, sqlClient: parksDb.sqlClient, queue: new queuePkg.MemoryQueue() };
  complaintsConsumer.registerComplaintConsumers(parks.queue);
  treeRequestsConsumer.registerTreeRequestConsumers(parks.queue);

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
  // tenantWrappedQueue helper) -- wrap it onto parks's SAME queue so the
  // relayed message reaches it correctly tenant-scoped.
  const rawSubscribe = parks.queue.subscribe.bind(parks.queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parks.queue.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => notification.runWithTenant(msg.tenantId, () => handler(msg)));
  deliveryConsumer.registerDeliveryConsumers(parks.queue);

  await parks.queue.start();
});

afterAll(async () => {
  await parks.queue.stop();
  await parks.sqlClient.end();
  await notification.sqlClient.end();
});

describe("parks-service -> notification-service citizen notifications -- real DB, no mocks", () => {
  it("CREATE_COMPLAINT relays into a real notification-service delivery row on the municipal.application.submitted template", async () => {
    const { relayOnce } = await import("@civitasone/outbox");
    const complaintId = randomUUID();
    const reportedBy = randomUUID();

    await parks.queue.publish("parks.complaint.create", makeMsg("parks.complaint.create", {
      id: complaintId,
      tenantId: TENANT,
      reportedBy,
      location: { lat: 12.97, lng: 77.59 },
      parkAssetRef: null,
      complaintType: "broken_equipment",
      description: "Swing set broken in sector 4 park",
      photo: null,
      severity: "medium",
    }));
    await parks.queue.drain();

    // Drain repeatedly rather than trusting a single relayOnce call: relayOnce
    // fans messages out over the queue's own async delivery, and one pass can
    // race ahead of a slow first connection to a freshly bootstrapped
    // container. Relay-to-completion (retry until nothing is left to relay)
    // is more robust than a single relayOnce + drain pair.
    let relayedTotal = 0;
    for (let i = 0; i < 5; i++) {
      const relayed = await relayOnce(parks.db as never, parks.queue, 100, "parks-service");
      relayedTotal += relayed;
      await parks.queue.drain();
      if (relayed === 0) break;
    }
    expect(relayedTotal, "parks's outbox must have had a pending notification.send message").toBeGreaterThan(0);

    const deliveries = await notification.findByRecipient(TENANT, reportedBy, 5);
    expect(deliveries.length, "notification-service's real deliveries consumer must have written a delivery row").toBeGreaterThan(0);
    const delivery = deliveries.find(
      (d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted,
    );
    expect(delivery, "must have a delivery resolved to the municipal.application.submitted template").toBeTruthy();
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
  });

  it("APPROVE_TREE_REQUEST relays into a real notification-service delivery row on the citizen.application.approved template", async () => {
    const { relayOnce } = await import("@civitasone/outbox");
    const requestId = randomUUID();
    const requestedBy = randomUUID();
    const approverId = randomUUID();

    await parks.queue.publish("parks.tree_request.create", makeMsg("parks.tree_request.create", {
      id: requestId,
      tenantId: TENANT,
      requestedBy,
      requestType: "pruning",
      location: { lat: 12.97, lng: 77.59 },
      treeSpecies: "Neem",
      reason: "Overhanging branches over footpath",
      photos: [],
    }));
    await parks.queue.drain();

    // CREATE_TREE_REQUEST above is the row's only mutation so far, and
    // repo.insert relies on the column default (schema.ts: `.default(1)`)
    // rather than setting it explicitly -- so the row is at version 1.
    // (Reading it back directly here would need its own runWithTenant/RLS
    // context, which this test has no reason to stand up separately from
    // the consumer path already under test.)
    await parks.queue.publish("parks.tree_request.approve", makeMsg("parks.tree_request.approve", {
      id: requestId,
      tenantId: TENANT,
      approvedBy: approverId,
      version: 1,
    }));
    await parks.queue.drain();

    let relayedTotal = 0;
    for (let i = 0; i < 5; i++) {
      const relayed = await relayOnce(parks.db as never, parks.queue, 100, "parks-service");
      relayedTotal += relayed;
      await parks.queue.drain();
      if (relayed === 0) break;
    }
    expect(relayedTotal, "parks's outbox must have had pending notification.send messages").toBeGreaterThan(0);

    // Both notifications share recipientId = requestedBy (create's own
    // acknowledgement and approve's decision notification), so select by
    // template rather than trusting deliveries[0].
    const deliveries = await notification.findByRecipient(TENANT, requestedBy, 5);
    expect(deliveries.length, "notification-service's real deliveries consumer must have written delivery rows").toBeGreaterThan(0);
    const delivery = deliveries.find(
      (d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.citizenApplicationApproved,
    );
    expect(delivery, "must have a delivery resolved to the citizen.application.approved template").toBeTruthy();
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
  });
});
