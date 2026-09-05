/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * refund-service's src/shared/cross-events.ts was ported/written but never
 * called from any command/consumer until this change. This proves the
 * wiring added here (processing/consumer.ts's approveRequest [fully
 * approved only] / rejectRequest / returnRequest, and reconciliation/
 * consumer.ts's completeDisbursement / failDisbursement) actually reaches
 * notification-service end to end: relaying refund-service's outbox onto a
 * shared queue and letting notification-service's real deliveries consumer
 * run produces a real delivery row, resolved to the real seeded
 * municipal.status.changed template (migration
 * 0044_municipal_templates.sql), not the generic default.
 *
 * Deliberately notification-only: this file has NO finance-service hop and
 * asserts nothing about finance.challan.create, because this PR does not
 * wire one — see src/shared/cross-events.ts's header for the full
 * reasoning (a refund disbursement is money leaving the treasury, the
 * opposite direction from what the fee-challan contract models).
 *
 * Three of the five wiring points are exercised end-to-end here (approved,
 * rejected, disbursement completed). returnRequest and failDisbursement
 * are not separately driven through a second full DB round-trip: they call
 * the exact same emitMunicipalNotification helper through the exact same
 * `if (request) { ... }` branch shape as rejectRequest and
 * completeDisbursement respectively (see processing/consumer.ts and
 * reconciliation/consumer.ts) — same proportionality call the drainage-
 * service/sewerage-service Wave 3 tests already made for their own
 * symmetric branches.
 *
 * Same dual-DSN dynamic-import technique as building-service's
 * municipal-status-notification-integration.test.ts: refund-service's own
 * shared/db.ts is imported statically as usual (this file's own
 * DATABASE_URL, from vitest.config.ts); notification-service's db.ts/
 * consumer/schema modules are imported dynamically AFTER swapping
 * process.env.DATABASE_URL (and its other required env vars) to
 * notification-service's own connection, since createTenantDb() reads
 * DATABASE_URL once at import time.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

import { db as refundDb, sqlClient as refundSqlClient } from "../src/shared/db.js";
import { outboxMessages as refundOutboxMessages } from "../src/shared/outbox.js";
import { refundRequests } from "../src/modules/requests/schema.js";
import { refundDisbursements } from "../src/modules/reconciliation/schema.js";
import { registerRequestConsumers } from "../src/modules/requests/consumer.js";
import { registerProcessingConsumers } from "../src/modules/processing/consumer.js";
import { registerReconciliationConsumers } from "../src/modules/reconciliation/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "6e000001-ec00-4000-8000-0000000000ff";

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

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like
 *  production. */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

/**
 * Drain-to-completion wrapper around relayOnce, not a single fixed-batch
 * call. relayOnce's own query (packages/outbox/src/index.ts) selects
 * unpublished rows with NO tenant/service scoping — the oldest `batch` rows
 * across the WHOLE outbox table. refund-service's other pre-existing
 * integration test files (http-routes, rls-raw, race-guard-integration,
 * processing-supersede-integration, race-lost-rollback,
 * assert-actionable-integration) all exercise consumers that enqueue real
 * outbox rows (requestApproved/requestRejected/etc.) via the same shared,
 * persistent test database and never relay or delete them — so this
 * database accumulates an ever-growing backlog of unpublished rows across
 * every test run in this same container. A single relayOnce(...) call only
 * ever claims the OLDEST `batch` such rows; once the backlog exceeds the
 * batch size, THIS test's own freshly-enqueued notification.send row sorts
 * behind it and is never selected — exactly the relay-race flakiness class
 * this session's other Wave 3 services already hit and fixed the same way
 * (animal-service, building-service, sewerage-service, drainage-service).
 * Looping relayOnce until it returns 0 drains the entire backlog every
 * time, at the harmless cost of also publishing those other files'
 * unrelated rows onto this test's private queue `q` (an event topic with
 * no matching subscriber here is simply marked published with no effect).
 */
async function drainRelay(db: unknown, q: MemoryQueue, service: string): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await relayOnce(db as never, q, 500, service);
    if (n === 0) return total;
    total += n;
  }
}

const NOTIFICATION_URL =
  process.env.REFUND_TEST_NOTIFICATION_DATABASE_URL ??
  "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;
const createdRequestIds: string[] = [];

beforeAll(async () => {
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
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    refundDb.transaction(async (tx) => {
      if (createdRequestIds.length > 0) {
        await tx.delete(refundDisbursements).where(and(eq(refundDisbursements.tenantId, TENANT)));
        await tx.delete(refundRequests).where(eq(refundRequests.tenantId, TENANT));
      }
      await tx.delete(refundOutboxMessages).where(eq(refundOutboxMessages.tenantId, TENANT));
    }),
  );
  if (notification?.db) {
    const { notificationDeliveries } = await import("../../notification-service/src/modules/deliveries/schema.js");
    await withTenantScope(notification.db as never, TENANT, (tx: any) =>
      tx.delete(notificationDeliveries).where(eq(notificationDeliveries.tenantId, TENANT)),
    );
  }
  await refundSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

/** Fully drives create -> submit -> under_review for a fresh refund request. */
async function createAndSubmit(q: MemoryQueue, applicantName: string): Promise<{ id: string; requestNumber: string }> {
  const id = randomUUID();
  createdRequestIds.push(id);
  await q.publish(
    COMMANDS.createRequest,
    makeMsg(COMMANDS.createRequest, {
      id,
      tenantId: TENANT,
      applicantName,
      applicantPhone: "9876543210",
      originalServiceType: "shop",
      originalTransactionRef: `SHOP-${id.slice(0, 8)}`,
      originalAmountMinor: "500000",
      refundAmountMinor: "300000",
      refundReason: "overpayment",
    }),
  );
  await q.drain();
  await q.publish(COMMANDS.submitRequest, makeMsg(COMMANDS.submitRequest, { id, tenantId: TENANT }));
  await q.drain();

  const [row] = await runWithTenant(TENANT, () =>
    refundDb.transaction((tx) => tx.select().from(refundRequests).where(eq(refundRequests.id, id)).limit(1)),
  );
  expect(row, "refund request row must exist after create+submit").toBeTruthy();
  expect(row!.status).toBe("under_review");
  return { id, requestNumber: row!.requestNumber };
}

async function findStatusChangedDelivery(recipientId: string) {
  const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, recipientId, 20);
  return deliveries.find((d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalStatusChanged);
}

/**
 * municipalDecisionNotificationEventType (packages/events/src/municipal-cross.ts)
 * special-cases decision === "approved" to the generic, cross-domain
 * citizen.application.approved template rather than municipal.status.changed
 * — the same routing every other Wave 3 service's approve/decide consumer
 * goes through (see e.g. shop-service/src/modules/approvals/consumer.ts).
 * Only "approved" gets this template; "rejected"/"returned" fall back to
 * municipal.status.changed (see findStatusChangedDelivery above).
 */
async function findApprovedDelivery(recipientId: string) {
  const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, recipientId, 20);
  return deliveries.find((d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.citizenApplicationApproved);
}

async function assertResolvesToRealTemplate(templateId: string, expectedName: string) {
  const [templateRow] = await withTenantScope(notification.db as never, "00000000-0000-0000-0000-000000000000", (tx: any) =>
    tx.select().from(notification.notificationTemplates).where(eq(notification.notificationTemplates.id, templateId)).limit(1),
  );
  expect(templateRow, "the resolved templateId must correspond to a real seeded template row").toBeTruthy();
  expect(templateRow.name).toBe(expectedName);
}

describe("refund-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("approveRequest at the final (authorizer) level notifies the citizen with a real, non-default delivery", async () => {
    const q = tenantWrappedQueue();
    registerRequestConsumers(q);
    registerProcessingConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const { id: requestId } = await createAndSubmit(q, "Approve Wave3 Test Applicant");

    await q.publish(COMMANDS.approveRequest, makeMsg(COMMANDS.approveRequest, {
      id: randomUUID(), requestId, tenantId: TENANT, level: 1, remarks: "checker ok",
    }));
    await q.drain();

    // Level-1 (checker) approval alone must NOT notify the citizen — only
    // the fully-approved (level 2 / authorizer) transition is citizen-
    // meaningful. Relay now and confirm nothing lands yet.
    await drainRelay(refundDb, q, "refund-service");
    await q.drain();
    expect(await findApprovedDelivery(requestId), "level-1 approval alone must not notify the citizen").toBeFalsy();

    await q.publish(COMMANDS.approveRequest, makeMsg(COMMANDS.approveRequest, {
      id: randomUUID(), requestId, tenantId: TENANT, level: 2, remarks: "authorizer ok",
    }));
    await q.drain();

    const [row] = await runWithTenant(TENANT, () =>
      refundDb.transaction((tx) => tx.select().from(refundRequests).where(eq(refundRequests.id, requestId)).limit(1)),
    );
    expect(row!.status).toBe("approved");

    const relayed = await drainRelay(refundDb, q, "refund-service");
    expect(relayed, "refund-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const delivery = await findApprovedDelivery(requestId);
    expect(delivery, "notification-service must have a citizen.application.approved delivery for the fully-approved request").toBeTruthy();
    expect(delivery.recipient).toBe("Approve Wave3 Test Applicant");
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    await assertResolvesToRealTemplate(delivery.templateId, "citizen.application.approved");

    await q.stop();
  });

  it("rejectRequest notifies the citizen with a real, non-default delivery", async () => {
    const q = tenantWrappedQueue();
    registerRequestConsumers(q);
    registerProcessingConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const { id: requestId } = await createAndSubmit(q, "Reject Wave3 Test Applicant");

    await q.publish(COMMANDS.rejectRequest, makeMsg(COMMANDS.rejectRequest, {
      id: randomUUID(), requestId, tenantId: TENANT, level: 1, remarks: "documents insufficient",
    }));
    await q.drain();

    const [row] = await runWithTenant(TENANT, () =>
      refundDb.transaction((tx) => tx.select().from(refundRequests).where(eq(refundRequests.id, requestId)).limit(1)),
    );
    expect(row!.status).toBe("rejected");

    const relayed = await drainRelay(refundDb, q, "refund-service");
    expect(relayed, "refund-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const delivery = await findStatusChangedDelivery(requestId);
    expect(delivery, "notification-service must have a municipal.status.changed delivery for the rejected request").toBeTruthy();
    expect(delivery.recipient).toBe("Reject Wave3 Test Applicant");
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    await assertResolvesToRealTemplate(delivery.templateId, "municipal.status.changed");

    await q.stop();
  });

  it("completeDisbursement notifies the citizen that the refund landed, with a real, non-default delivery", async () => {
    const q = tenantWrappedQueue();
    registerRequestConsumers(q);
    registerProcessingConsumers(q);
    registerReconciliationConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const { id: requestId } = await createAndSubmit(q, "Disbursed Wave3 Test Applicant");

    await q.publish(COMMANDS.approveRequest, makeMsg(COMMANDS.approveRequest, {
      id: randomUUID(), requestId, tenantId: TENANT, level: 1, remarks: "checker ok",
    }));
    await q.drain();
    await q.publish(COMMANDS.approveRequest, makeMsg(COMMANDS.approveRequest, {
      id: randomUUID(), requestId, tenantId: TENANT, level: 2, remarks: "authorizer ok",
    }));
    await q.drain();
    // Drain away the requestApproved-side notification so it doesn't get
    // confused for the disbursement one below when both share this
    // request's id as recipientId.
    await drainRelay(refundDb, q, "refund-service");
    await q.drain();

    const disbursementId = randomUUID();
    await q.publish(COMMANDS.initiateDisbursement, makeMsg(COMMANDS.initiateDisbursement, {
      id: disbursementId,
      tenantId: TENANT,
      requestId,
      bankAccountDetails: { accountNumber: "000123456789", ifscCode: "SBIN0000001", accountHolderName: "Disbursed Wave3 Test Applicant" },
      disbursedAmountMinor: "300000",
    }));
    await q.drain();

    await q.publish(COMMANDS.completeDisbursement, makeMsg(COMMANDS.completeDisbursement, {
      id: disbursementId, tenantId: TENANT, disbursementRef: "UTR-WAVE3-TEST-0001",
    }));
    await q.drain();

    const [row] = await runWithTenant(TENANT, () =>
      refundDb.transaction((tx) => tx.select().from(refundRequests).where(eq(refundRequests.id, requestId)).limit(1)),
    );
    expect(row!.status).toBe("refunded");

    const relayed = await drainRelay(refundDb, q, "refund-service");
    expect(relayed, "refund-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const delivery = await findStatusChangedDelivery(requestId);
    expect(delivery, "notification-service must have a municipal.status.changed delivery for the completed disbursement").toBeTruthy();
    expect(delivery.recipient).toBe("Disbursed Wave3 Test Applicant");
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    await assertResolvesToRealTemplate(delivery.templateId, "municipal.status.changed");

    await q.stop();
  });
});
