/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * connections/consumer.ts's connectionApply emits notification.send
 * atomically with the application-submitted row (this PR's wiring); relaying
 * it into notification-service's real deliveries consumer produces a real
 * delivery row resolved to the municipal.application.submitted template, not
 * the generic default. Mirrors
 * notification-service/tests/municipal-template-integration.test.ts,
 * shop-service/tests/cross-events-integration.test.ts and
 * vendor-service/tests/municipal-status-notification-integration.test.ts.
 *
 * connectionApply is a single command (there is no separate draft->submit
 * step in this module — the command IS the submission), so, kept to a
 * single request/notification per tonight's-known-gotcha note
 * (services/notification-service/deliveries/consumer.ts's quota/DLT checks
 * previously opened a nested transaction on the same pool as the outer send
 * transaction, deadlocking once concurrent sends exceeded the pool size —
 * PR #1028), this test drives exactly one real delivery through
 * notification-service, not a batch.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";

import { db as sewerageDb, sqlClient as sewerageSqlClient } from "../src/shared/db.js";
import { outboxMessages as sewerageOutboxMessages } from "../src/shared/outbox.js";
import { sewerageApplications } from "../src/modules/connections/schema.js";
import { registerConnectionConsumers } from "../src/modules/connections/consumer.js";
import { COMMANDS as SEWERAGE_COMMANDS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "2e000001-ec00-4000-8000-0000000000ff";

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

/**
 * relayOnce fetches the OLDEST `batch` unpublished rows service-wide
 * (ORDER BY created_at ASC LIMIT batch — see packages/outbox/src/index.ts;
 * it has no per-test or per-tenant filter). sewerage-service's OTHER
 * integration test files (hardening, routes-health, complaints-flow, ...)
 * exercise these same consumers extensively and never relay or clean up
 * their own audit.event.record/notification.send outbox rows — verified
 * against a real Postgres container: a single full-suite run left ~200
 * unpublished rows behind before this test's own row was even created. A
 * single relayOnce(..., 100, ...) call (this file's own reference
 * templates' convention) can silently miss this test's fresh row entirely
 * behind that backlog. Drain in a loop instead, so this test's own row is
 * relayed regardless of how much backlog earlier files left behind.
 */
async function drainOutbox(db: unknown, queue: MemoryQueue, service: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const n = await relayOnce(db as never, queue, 500, service);
    total += n;
    if (n === 0) break;
  }
  return total;
}

const NOTIFICATION_URL =
  process.env.SEWERAGE_TEST_NOTIFICATION_DATABASE_URL ??
  "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;
let applicationId: string;

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
  if (applicationId) {
    await runWithTenant(TENANT, () =>
      sewerageDb.transaction((tx) =>
        tx.delete(sewerageApplications).where(and(eq(sewerageApplications.id, applicationId), eq(sewerageApplications.tenantId, TENANT))),
      ),
    );
  }
  await runWithTenant(TENANT, () =>
    sewerageDb.transaction((tx) =>
      tx.delete(sewerageOutboxMessages).where(eq(sewerageOutboxMessages.tenantId, TENANT)),
    ),
  );
  await sewerageSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("sewerage-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("connectionApply raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerConnectionConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    applicationId = randomUUID();
    await q.publish(
      SEWERAGE_COMMANDS.connectionApply,
      makeMsg(SEWERAGE_COMMANDS.connectionApply, {
        id: applicationId,
        tenantId: TENANT,
        propertyRef: "PROP-9988",
        waterConnectionRef: "WC-4477",
        connectionClass: "domestic",
        siteDetails: null,
      }),
    );
    await q.drain();

    const [appRow] = await runWithTenant(TENANT, () =>
      sewerageDb.transaction((tx) =>
        tx.select().from(sewerageApplications).where(eq(sewerageApplications.id, applicationId)).limit(1),
      ),
    );
    expect(appRow, "sewerage application row must exist").toBeTruthy();
    expect(appRow!.status).toBe("submitted");

    // Relay sewerage-service's outbox — the single notification.send row
    // from connectionApply; notification-service's real delivery consumer
    // (subscribed above) picks it up and writes a delivery row.
    const relayed = await drainOutbox(sewerageDb, q, "sewerage-service");
    expect(relayed, "sewerage-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, applicationId, 5);
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
