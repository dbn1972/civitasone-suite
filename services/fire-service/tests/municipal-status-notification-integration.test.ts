/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * applications/consumer.ts's submitApplication emits notification.send
 * atomically with the application-submitted row (this PR's wiring); relaying
 * it into notification-service's real deliveries consumer produces a real
 * delivery row resolved to the municipal.application.submitted template, not
 * the generic default. Mirrors
 * notification-service/tests/municipal-template-integration.test.ts,
 * shop-service/tests/cross-events-integration.test.ts and
 * sewerage-service/tests/municipal-status-notification-integration.test.ts.
 *
 * fire-service has a real draft->submit step (unlike sewerage's
 * connections module, where the apply command IS the submission), so this
 * drives two real commands — createApplication then submitApplication —
 * through fire-service's own consumers first, then relays only the single
 * notification.send row the submit step raises into notification-service,
 * not a batch (kept to exactly one real delivery per tonight's-known-gotcha
 * note: notification-service/deliveries/consumer.ts's quota/DLT checks
 * previously opened a nested transaction on the same pool as the outer send
 * transaction, deadlocking once concurrent sends exceeded the pool size —
 * PR #1028).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";

import { db as fireDb, sqlClient as fireSqlClient } from "../src/shared/db.js";
import { outboxMessages as fireOutboxMessages } from "../src/shared/outbox.js";
import { fireApplicationsTable } from "../src/modules/applications/schema.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { COMMANDS as FIRE_COMMANDS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "4e000001-fc00-4000-8000-0000000000ff";

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
 * it has no per-test or per-tenant filter). fire-service's OTHER
 * integration test files (PR #1011's 57-test real-DB suite) exercise these
 * same consumers heavily and never relay their own outbox debt — a single
 * relayOnce(..., 100, ...) call can silently miss this test's own fresh row
 * behind that backlog (verified against a real Postgres container, same
 * finding as sewerage-service/parking-service's equivalent tests). Drain in
 * a loop instead, so this test's own row is relayed regardless of how much
 * backlog earlier files left behind. This test's createApplication step
 * also raises its own finance.challan.create row (this PR's other wiring) —
 * draining in a loop relays that one too, harmlessly, since no finance
 * consumer is registered on this queue.
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
  process.env.FIRE_TEST_NOTIFICATION_DATABASE_URL ??
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
      fireDb.transaction((tx) =>
        tx.delete(fireApplicationsTable).where(and(eq(fireApplicationsTable.id, applicationId), eq(fireApplicationsTable.tenantId, TENANT))),
      ),
    );
  }
  await runWithTenant(TENANT, () =>
    fireDb.transaction((tx) =>
      tx.delete(fireOutboxMessages).where(eq(fireOutboxMessages.tenantId, TENANT)),
    ),
  );
  await fireSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("fire-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("submitApplication raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerApplicationConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    applicationId = randomUUID();
    await q.publish(
      FIRE_COMMANDS.createApplication,
      makeMsg(FIRE_COMMANDS.createApplication, {
        id: applicationId,
        buildingName: "Lakeview Commercial Tower",
        buildingAddress: { line1: "44 MG Road", city: "Pune", pin: "411001" },
        occupancyType: "commercial",
        builtUpArea: "5000",
      }),
    );
    await q.drain();

    let appRow: { status: string } | undefined;
    [appRow] = await runWithTenant(TENANT, () =>
      fireDb.transaction((tx) =>
        tx.select().from(fireApplicationsTable).where(eq(fireApplicationsTable.id, applicationId)).limit(1),
      ),
    );
    expect(appRow, "fire application row must exist after create").toBeTruthy();
    expect(appRow!.status).toBe("draft");

    await q.publish(
      FIRE_COMMANDS.submitApplication,
      makeMsg(FIRE_COMMANDS.submitApplication, { applicationId }),
    );
    await q.drain();

    [appRow] = await runWithTenant(TENANT, () =>
      fireDb.transaction((tx) =>
        tx.select().from(fireApplicationsTable).where(eq(fireApplicationsTable.id, applicationId)).limit(1),
      ),
    );
    expect(appRow!.status).toBe("submitted");

    // Relay fire-service's outbox — this includes the createApplication step's
    // finance.challan.create row (harmlessly relayed with no consumer for it
    // on this queue) and the notification.send row from submitApplication;
    // notification-service's real delivery consumer (subscribed above) picks
    // up the latter and writes a delivery row.
    const relayed = await drainOutbox(fireDb, q, "fire-service");
    expect(relayed, "fire-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
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
