/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * parking-service's shared/cross-events.ts (this change) is wired into
 * bookings/consumer.ts and enforcement/consumer.ts — this proves the wiring
 * actually reaches the receiving services end to end:
 *
 *   1. enforcement/consumer.ts's issueViolation emits finance.challan.create
 *      atomically with the violation row (the fine is known immediately at
 *      issuance — see the comment in that file for why this is the correct
 *      integration point, unlike the booking side); relaying parking's
 *      outbox onto a shared queue and letting finance-service's real
 *      treasury+gl consumers run produces a real GL journal row in
 *      finance-service's own database, back-linked to the violation
 *      (sourceService="parking", sourceRef=violationNumber) with the fine
 *      amount preserved exactly (mirrors
 *      finance-service/tests/municipal-challan-integration.test.ts and
 *      shop-service/tests/cross-events-integration.test.ts).
 *   2. bookings/consumer.ts's createBooking emits notification.send
 *      atomically with the booking row; relaying it into
 *      notification-service's real deliveries consumer produces a real
 *      delivery row resolved to the municipal.status.changed template, not
 *      the generic default.
 *
 * Only two commands are published across both cases (kept deliberately
 * modest — see the notification-service quota/DLT deadlock note in this
 * change's PR description).
 *
 * finance-service and notification-service are separate services with their
 * own databases — this file dynamically imports their db.ts/consumer/schema
 * modules AFTER swapping process.env.DATABASE_URL (and their other required
 * env vars) to each service's own connection, since createTenantDb() reads
 * DATABASE_URL once at import time. parking-service's own db.ts is imported
 * statically at the top of this file as usual, under parking's own
 * DATABASE_URL from vitest.config.ts / the test run's env. Pattern copied
 * from services/shop-service/tests/cross-events-integration.test.ts (PR
 * #1021) and services/trade-service/tests/cross-service-integration.test.ts
 * (PR #1022), both merged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as parkingDb, sqlClient as parkingSqlClient } from "../src/shared/db.js";
import { outboxMessages as parkingOutboxMessages } from "../src/shared/outbox.js";
import { parkingBookings } from "../src/modules/bookings/schema.js";
import { parkingViolations } from "../src/modules/enforcement/schema.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { registerEnforcementConsumers } from "../src/modules/enforcement/consumer.js";
import { COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ee000003-ec00-4000-8000-0000000000ff";
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

const FINANCE_URL = process.env.PARKING_TEST_FINANCE_DATABASE_URL
  ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";
const NOTIFICATION_URL = process.env.PARKING_TEST_NOTIFICATION_DATABASE_URL
  ?? "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

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
      name: "Bank (parking cross-events integration test)",
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
    parkingDb.transaction(async (tx) => {
      await tx.delete(parkingViolations).where(eq(parkingViolations.tenantId, TENANT));
      await tx.delete(parkingBookings).where(eq(parkingBookings.tenantId, TENANT));
      await tx.delete(parkingOutboxMessages).where(eq(parkingOutboxMessages.tenantId, TENANT));
    }),
  );
  await parkingSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("parking-service cross-events wiring — real DB, no mocks", () => {
  it("issueViolation raises a fine challan that lands as a real finance GL journal, back-linked to the violation", async () => {
    const q = tenantWrappedQueue();
    registerEnforcementConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const violationId = randomUUID();
    await q.publish(
      COMMANDS.issueViolation,
      makeMsg(COMMANDS.issueViolation, {
        id: violationId,
        tenantId: TENANT,
        vehicleNumber: "KA01AB1234",
        violationType: "obstruction", // calculateFineMinor("obstruction") = 200000n (Rs 2000)
      }),
    );
    await q.drain();

    // Hop 1: relay parking-service's own outbox — publishes
    // finance.challan.create onto the shared queue, which finance-service's
    // treasury consumer (already subscribed above) picks up and processes
    // against finance's own database.
    const relayed1 = await relayOnce(parkingDb as never, q, 100, "parking-service");
    expect(relayed1, "parking-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    // Hop 2: the treasury consumer enqueued finance.gl.post into finance's
    // OWN outbox (same tx) — relay that too, like the real outbox relay would.
    await relayOnce(finance.db as never, q, 100, "finance-service");
    await q.drain();

    const [violationRow] = await runWithTenant(TENANT, () =>
      parkingDb.transaction((tx) =>
        tx.select().from(parkingViolations).where(eq(parkingViolations.id, violationId)).limit(1),
      ),
    );
    expect(violationRow, "parking violation row must exist").toBeTruthy();
    expect(violationRow!.fineMinor).toBe(200000n);

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="parking", sourceRef=violationNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "parking"), eq(finance.financeChallans.sourceRef, violationRow!.violationNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the violation").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(violationRow!.fineMinor);

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
    expect(creditLine.creditMinor).toBe(violationRow!.fineMinor.toString());
    expect(debitLine.debitMinor).toBe(violationRow!.fineMinor.toString());
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });

  it("createBooking raises a citizen status notification that lands as a real notification-service delivery, resolved to the municipal template", async () => {
    const q = tenantWrappedQueue();
    registerBookingConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const bookingId = randomUUID();
    await q.publish(
      COMMANDS.createBooking,
      makeMsg(COMMANDS.createBooking, {
        id: bookingId,
        tenantId: TENANT,
        facilityId: randomUUID(),
        vehicleNumber: "KA05CD5678",
        vehicleType: "car",
      }),
    );
    await q.drain();

    const [bookingRow] = await runWithTenant(TENANT, () =>
      parkingDb.transaction((tx) =>
        tx.select().from(parkingBookings).where(eq(parkingBookings.id, bookingId)).limit(1),
      ),
    );
    expect(bookingRow!.status).toBe("booked");

    // Relay parking's outbox — publishes the notification.send row from
    // createBooking; notification-service's real delivery consumer
    // (subscribed above) picks it up and writes a delivery row.
    const relayed = await relayOnce(parkingDb as never, q, 100, "parking-service");
    expect(relayed, "parking-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, ACTOR, 5);
    expect(deliveries.length, "notification-service must have written a delivery row").toBeGreaterThan(0);
    const delivery = deliveries[0]!;
    expect(delivery.templateId, "must resolve to the real municipal.status.changed template, not the generic default")
      .not.toBe("00000000-0000-4000-8001-000000000000");

    const [templateRow] = await withTenantScope(notification.db as never, "00000000-0000-0000-0000-000000000000", (tx: any) =>
      tx.select().from(notification.notificationTemplates)
        .where(eq(notification.notificationTemplates.id, delivery.templateId))
        .limit(1),
    );
    expect(templateRow, "the resolved templateId must correspond to a real seeded template row").toBeTruthy();
    expect(templateRow.name).toBe("municipal.status.changed");

    await q.stop();
  });
});
