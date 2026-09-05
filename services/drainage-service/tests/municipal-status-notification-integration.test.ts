/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * complaints/consumer.ts's complaintCreate emits notification.send
 * atomically with the complaint row (this PR's wiring); relaying it into
 * notification-service's real deliveries consumer produces a real delivery
 * row resolved to the municipal.application.submitted template, not the
 * generic default. Mirrors sewerage-service/tests/municipal-status-
 * notification-integration.test.ts (PR #1029) and shop-service/tests/
 * cross-events-integration.test.ts (PR #1021).
 *
 * Only a notification test exists here, no fee-challan companion: I read
 * complaints/schema.ts, field_actions/schema.ts and hotspots/schema.ts
 * directly and none of the three tables carries a money field of any kind —
 * drainage-service has no citizen-facing fee anywhere in its domain (see
 * src/shared/cross-events.ts's header for the full reasoning). Only
 * complaintCreate is driven through here (kept to a single request/
 * notification, same reasoning as sewerage's own test re PR #1028's nested-
 * transaction pool-exhaustion deadlock) — complaintAssign/complaintResolve/
 * fieldActionCreate's notification wiring share the exact same
 * emitMunicipalNotification call path and are covered by the unit-level
 * assertions in tests/complaints.test.ts and tests/field-actions.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";

import { db as drainageDb, sqlClient as drainageSqlClient } from "../src/shared/db.js";
import { outboxMessages as drainageOutboxMessages } from "../src/shared/outbox.js";
import { drainageComplaints } from "../src/modules/complaints/schema.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { COMMANDS as DRAINAGE_COMMANDS } from "../src/topics.js";

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
 * it has no per-test or per-tenant filter). drainage-service's OTHER
 * integration test files (complaints, field-actions, hotspots, cas-
 * concurrency, number-uniqueness, tenant-isolation) all write audit.event.
 * record outbox rows and never relay or clean them up. A single
 * relayOnce(..., N, ...) call can silently miss this test's fresh row
 * behind that backlog. Drain in a loop instead, so this test's own row is
 * relayed regardless of how much backlog earlier files left behind — same
 * helper as sewerage-service's/building-service's own Wave 3 files.
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
  process.env.DRAINAGE_TEST_NOTIFICATION_DATABASE_URL ??
  "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;
let complaintId: string;

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
  if (complaintId) {
    await runWithTenant(TENANT, () =>
      drainageDb.transaction((tx) =>
        tx.delete(drainageComplaints).where(and(eq(drainageComplaints.id, complaintId), eq(drainageComplaints.tenantId, TENANT))),
      ),
    );
  }
  await runWithTenant(TENANT, () =>
    drainageDb.transaction((tx) =>
      tx.delete(drainageOutboxMessages).where(eq(drainageOutboxMessages.tenantId, TENANT)),
    ),
  );
  await drainageSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("drainage-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("complaintCreate raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerComplaintConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    complaintId = randomUUID();
    const complaintNumber = `DRN-TEST-${Date.now()}`;
    await q.publish(
      DRAINAGE_COMMANDS.complaintCreate,
      makeMsg(DRAINAGE_COMMANDS.complaintCreate, {
        id: complaintId,
        complaintNumber,
        reportedBy: ACTOR,
        location: { ward: "7" },
        complaintType: "blocked_drain",
        description: "Storm drain overflowing onto the road",
        photo: null,
        severity: "high",
      }),
    );
    await q.drain();

    const [complaintRow] = await runWithTenant(TENANT, () =>
      drainageDb.transaction((tx) =>
        tx.select().from(drainageComplaints).where(eq(drainageComplaints.id, complaintId)).limit(1),
      ),
    );
    expect(complaintRow, "drainage complaint row must exist").toBeTruthy();
    expect(complaintRow!.status).toBe("reported");

    // Relay drainage-service's outbox — the single notification.send row
    // from complaintCreate; notification-service's real delivery consumer
    // (subscribed above) picks it up and writes a delivery row.
    const relayed = await drainOutbox(drainageDb, q, "drainage-service");
    expect(relayed, "drainage-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, complaintId, 5);
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
