/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * registrations/consumer.ts's submitRegistration emits notification.send
 * atomically with the status transition (this PR's wiring); relaying it
 * into notification-service's real deliveries consumer produces a real
 * delivery row resolved to the municipal.application.submitted template,
 * not the generic default. Mirrors
 * notification-service/tests/municipal-template-integration.test.ts and
 * shop-service/tests/cross-events-integration.test.ts.
 *
 * Kept to a single request/notification per the tonight's-known-gotcha note
 * (services/notification-service/deliveries/consumer.ts's quota/DLT checks
 * previously opened a nested transaction on the same pool as the outer send
 * transaction, deadlocking once concurrent sends exceeded the pool size) —
 * this test drives exactly one real delivery through notification-service,
 * not a batch.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";

import { db as vendorDb, sqlClient as vendorSqlClient } from "../src/shared/db.js";
import { outboxMessages as vendorOutboxMessages } from "../src/shared/outbox.js";
import { vendorRegistrations } from "../src/modules/registrations/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { COMMANDS as VENDOR_COMMANDS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ff000001-ec00-4000-8000-0000000000ff";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

const NOTIFICATION_URL =
  process.env.VENDOR_TEST_NOTIFICATION_DATABASE_URL ??
  "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;
let registrationId: string;

async function importNotification() {
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = NOTIFICATION_URL;
  process.env.NOTIFICATION_PII_KEY = process.env.NOTIFICATION_PII_KEY ?? "test_notification_pii_key_32chars";
  process.env.NOTIFICATION_PII_SALT = process.env.NOTIFICATION_PII_SALT ?? "civitas-notification-pii-test";
  process.env.NOTIFICATION_EMAIL_DRIVER = process.env.NOTIFICATION_EMAIL_DRIVER ?? "stub";
  process.env.NOTIFICATION_IN_APP_DRIVER = process.env.NOTIFICATION_IN_APP_DRIVER ?? "memory";
  process.env.NOTIFICATION_SMS_DRIVER = process.env.NOTIFICATION_SMS_DRIVER ?? "stub";
  process.env.NOTIFICATION_WHATSAPP_DRIVER = process.env.NOTIFICATION_WHATSAPP_DRIVER ?? "stub";
  const notificationDbMod = await import("../../notification-service/src/shared/db.js");
  const { registerDeliveryConsumers } = await import("../../notification-service/src/modules/deliveries/consumer.js");
  const deliveriesRepo = await import("../../notification-service/src/modules/deliveries/repo.js");
  const { notificationTemplates } = await import("../../notification-service/src/modules/templates/schema.js");
  notification = {
    db: notificationDbMod.db,
    sqlClient: notificationDbMod.sqlClient,
    registerDeliveryConsumers,
    deliveriesRepo,
    notificationTemplates,
  };
  process.env.DATABASE_URL = originalUrl;
}

afterAll(async () => {
  if (registrationId) {
    await runWithTenant(TENANT, () =>
      vendorDb.transaction((tx) =>
        tx.delete(vendorRegistrations).where(and(eq(vendorRegistrations.id, registrationId), eq(vendorRegistrations.tenantId, TENANT))),
      ),
    );
  }
  await runWithTenant(TENANT, () =>
    vendorDb.transaction((tx) =>
      tx.delete(vendorOutboxMessages).where(eq(vendorOutboxMessages.tenantId, TENANT)),
    ),
  );
  await vendorSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("vendor-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("submitRegistration raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerRegistrationConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    registrationId = randomUUID();
    await q.publish(
      VENDOR_COMMANDS.createRegistration,
      makeMsg(VENDOR_COMMANDS.createRegistration, {
        id: registrationId,
        tenantId: TENANT,
        vendorName: "Lakshmi Flower Stall",
        vendorAadhaar: "987654321098",
        vendorPhone: "9123456780",
        category: "non_food",
      }),
    );
    await q.drain();

    await q.publish(
      VENDOR_COMMANDS.submitRegistration,
      makeMsg(VENDOR_COMMANDS.submitRegistration, { id: registrationId, tenantId: TENANT }),
    );
    await q.drain();

    const [regRow] = await runWithTenant(TENANT, () =>
      vendorDb.transaction((tx) =>
        tx.select().from(vendorRegistrations).where(eq(vendorRegistrations.id, registrationId)).limit(1),
      ),
    );
    expect(regRow!.status).toBe("submitted");

    // Relay vendor's outbox — the single notification.send row from
    // submitRegistration; notification-service's real delivery consumer
    // (subscribed above) picks it up and writes a delivery row.
    const relayed = await relayOnce(vendorDb as never, q, 100, "vendor-service");
    expect(relayed, "vendor-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, registrationId, 5);
    expect(deliveries.length, "notification-service must have written a delivery row").toBeGreaterThan(0);
    const delivery = deliveries[0]!;
    expect(delivery.templateId, "must resolve to the real municipal.application.submitted template, not the generic default")
      .not.toBe("00000000-0000-4000-8001-000000000000");

    const [templateRow] = await withTenantScope(notification.db as never, "00000000-0000-0000-0000-000000000000", (tx: any) =>
      tx.select().from(notification.notificationTemplates)
        .where(eq(notification.notificationTemplates.id, delivery.templateId))
        .limit(1),
    );
    expect(templateRow, "the resolved templateId must correspond to a real seeded template row").toBeTruthy();
    expect(templateRow.name).toBe("municipal.application.submitted");

    await q.stop();
  });
});
