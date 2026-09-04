/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * shop-service's shared/cross-events.ts (PR #1002) was merged but never
 * called from any command/consumer — this proves the wiring added in this
 * change actually reaches the receiving services end to end:
 *
 *   1. registrations/consumer.ts's createApplication emits
 *      finance.challan.create atomically with the application row; relaying
 *      shop's outbox onto a shared queue and letting finance-service's real
 *      treasury+gl consumers run produces a real GL journal row in
 *      finance-service's own database, back-linked to the shop application
 *      (sourceService="shop", sourceRef=applicationNumber) with the fee
 *      amount preserved exactly (mirrors
 *      finance-service/tests/municipal-challan-integration.test.ts).
 *   2. registrations/consumer.ts's submitApplication emits notification.send
 *      atomically with the status transition; relaying it into
 *      notification-service's real deliveries consumer produces a real
 *      delivery row resolved to the municipal.application.submitted
 *      template, not the generic default (mirrors
 *      notification-service/tests/municipal-template-integration.test.ts).
 *
 * finance-service and notification-service are separate services with their
 * own databases — this file dynamically imports their db.ts/consumer/schema
 * modules AFTER swapping process.env.DATABASE_URL (and their other required
 * env vars) to each service's own connection, since createTenantDb() reads
 * DATABASE_URL once at import time. shop-service's own db.ts is imported
 * statically at the top of this file as usual, under shop's own
 * DATABASE_URL from vitest.config.ts / the test run's env.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as shopDb, sqlClient as shopSqlClient } from "../src/shared/db.js";
import { outboxMessages as shopOutboxMessages } from "../src/shared/outbox.js";
import { applications } from "../src/modules/registrations/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { COMMANDS as SHOP_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "dd000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

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
 *  production (see the reference tests this file mirrors). */
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

const FINANCE_URL = process.env.SHOP_TEST_FINANCE_DATABASE_URL
  ?? "postgres://finance_svc:finance_dev_pw@localhost:5443/civitas_finance";
const NOTIFICATION_URL = process.env.SHOP_TEST_NOTIFICATION_DATABASE_URL
  ?? "postgres://notification_svc:notification_dev_pw@localhost:5443/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;

beforeAll(async () => {
  const originalUrl = process.env.DATABASE_URL;

  // ── finance-service: dynamically import with DATABASE_URL swapped ──
  process.env.DATABASE_URL = FINANCE_URL;
  process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_enc_key_for_finance_32c";
  process.env.DB_URL = FINANCE_URL;
  const financeDbMod = await import("../../finance-service/src/shared/db.js");
  const { registerTreasuryConsumers } = await import("../../finance-service/src/modules/treasury/consumer.js");
  const { registerGlConsumers } = await import("../../finance-service/src/modules/gl/consumer.js");
  const { financeHeads } = await import("../../finance-service/src/modules/budget/schema.js");
  const { financeChallans } = await import("../../finance-service/src/modules/treasury/schema.js");
  const { financeJournals } = await import("../../finance-service/src/modules/gl/schema.js");
  const { deterministicId } = await import("../../finance-service/src/modules/gl/spine.js");
  finance = {
    db: financeDbMod.db,
    sqlClient: financeDbMod.sqlClient,
    registerTreasuryConsumers,
    registerGlConsumers,
    financeHeads,
    financeChallans,
    financeJournals,
    deterministicId,
  };

  // Bank head (1100) is not seeded by any migration for this tenant — the
  // treasury consumer resolves it by code exactly like it resolves the
  // municipal fee head, so it is a test fixture here, exactly mirroring
  // finance-service's own municipal-challan-integration.test.ts beforeAll.
  await withTenantScope(finance.db, TENANT, (tx: never) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).insert(finance.financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: BANK_CODE,
      name: "Bank (shop cross-events integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );

  // ── notification-service: dynamically import with DATABASE_URL swapped ──
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
    shopDb.transaction(async (tx) => {
      await tx.delete(applications).where(eq(applications.tenantId, TENANT));
      await tx.delete(shopOutboxMessages).where(eq(shopOutboxMessages.tenantId, TENANT));
    }),
  );
  await shopSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("shop-service cross-events wiring — real DB, no mocks", () => {
  it("createApplication raises a fee challan that lands as a real finance GL journal, back-linked to the application", async () => {
    const q = tenantWrappedQueue();
    registerRegistrationConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const applicationId = randomUUID();
    await q.publish(
      SHOP_COMMANDS.createApplication,
      makeMsg(SHOP_COMMANDS.createApplication, {
        id: applicationId,
        tenantId: TENANT,
        establishmentName: "Acme Traders",
        establishmentType: "shop",
        ownerName: "Acme Traders Pvt Ltd",
        ownerType: "company",
        premisesAddress: { line1: "MG Road", city: "Bengaluru", pin: "560001" },
        activityCategory: "retail",
      }),
    );
    await q.drain();

    // Hop 1: relay shop-service's own outbox — publishes finance.challan.create
    // onto the shared queue, which finance-service's treasury consumer (already
    // subscribed above) picks up and processes against finance's own database.
    const relayed1 = await relayOnce(shopDb as never, q, 100, "shop-service");
    expect(relayed1, "shop-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    // Hop 2: the treasury consumer enqueued finance.gl.post into finance's OWN
    // outbox (same tx) — relay that too, like the real outbox relay would.
    await relayOnce(finance.db as never, q, 100, "finance-service");
    await q.drain();

    const [appRow] = await runWithTenant(TENANT, () =>
      shopDb.transaction((tx) =>
        tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1),
      ),
    );
    expect(appRow, "shop application row must exist").toBeTruthy();
    expect(appRow!.feeAmountMinor).toBeGreaterThan(0n);

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="shop", sourceRef=applicationNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "shop"), eq(finance.financeChallans.sourceRef, appRow!.applicationNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the shop application").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(appRow!.feeAmountMinor);

    // ── real GL journal row, correct amount, no precision loss ──
    const journalId = finance.deterministicId(`challan:${challanRow.id}`);
    const [journalRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeJournals).where(eq(finance.financeJournals.id, journalId)).limit(1),
    );
    expect(journalRow, "GL journal row must have been posted by the second hop (finance.gl.post)").toBeTruthy();
    expect(journalRow.lines).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const creditLine = journalRow.lines.find((l: any) => l.creditMinor !== "0");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debitLine = journalRow.lines.find((l: any) => l.debitMinor !== "0");
    expect(creditLine.creditMinor).toBe(appRow!.feeAmountMinor.toString());
    expect(debitLine.debitMinor).toBe(appRow!.feeAmountMinor.toString());
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });

  it("submitApplication raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    const q = tenantWrappedQueue();
    registerRegistrationConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const applicationId = randomUUID();
    await q.publish(
      SHOP_COMMANDS.createApplication,
      makeMsg(SHOP_COMMANDS.createApplication, {
        id: applicationId,
        tenantId: TENANT,
        establishmentName: "Bansal Bakery",
        establishmentType: "restaurant",
        ownerName: "Bansal Bakery Owner",
        ownerType: "individual",
        premisesAddress: { line1: "Church Street", city: "Bengaluru", pin: "560001" },
        activityCategory: "food_beverage",
      }),
    );
    await q.drain();
    // Relay + drain the fee-challan hop from createApplication too, so it
    // doesn't linger unpublished and confuse the relay count assertion below
    // (finance-service's consumers are not registered on this queue, so this
    // row would otherwise sit unpublished forever with no subscriber — that's
    // fine, relayOnce still marks it published once the queue accepts it).
    await relayOnce(shopDb as never, q, 100, "shop-service");
    await q.drain();

    await q.publish(
      SHOP_COMMANDS.submitApplication,
      makeMsg(SHOP_COMMANDS.submitApplication, { id: applicationId, tenantId: TENANT }),
    );
    await q.drain();

    const [appRow] = await runWithTenant(TENANT, () =>
      shopDb.transaction((tx) =>
        tx.select().from(applications).where(eq(applications.id, applicationId)).limit(1),
      ),
    );
    expect(appRow!.status).toBe("submitted");

    // Relay shop's outbox again — this time it's the notification.send row
    // from submitApplication; notification-service's real delivery consumer
    // (subscribed above) picks it up and writes a delivery row.
    const relayed = await relayOnce(shopDb as never, q, 100, "shop-service");
    expect(relayed, "shop-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, appRow!.applicantId, 5);
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
