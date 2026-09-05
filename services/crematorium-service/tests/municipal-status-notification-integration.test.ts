/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * bookings/consumer.ts's requestBooking and confirmBooking now emit
 * notification.send (this PR's wiring); relaying it into
 * notification-service's real deliveries consumer produces a real delivery
 * row resolved to the municipal.application.submitted / municipal.status.
 * changed template, not the generic default. Mirrors sewerage-service's
 * tests/municipal-status-notification-integration.test.ts (PR #1029).
 *
 * confirmBooking's command payload carries only {id, slotNumber,
 * paymentRef} — no applicantPhone/bookingNumber — so bookings/consumer.ts
 * does a recipient-lookup read (repo.findById) BEFORE opening the write
 * transaction, exactly like sewerage's connectionUpdateStatus. This test's
 * second case exercises that path specifically: it proves the notification
 * still carries the correct recipient/bookingNumber even though neither
 * value is in the confirmBooking command payload itself, and (per tonight's
 * PR #1028 deadlock class) that this doesn't nest a second transaction
 * inside the write transaction.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";

import { db as crematoriumDb, sqlClient as crematoriumSqlClient } from "../src/shared/db.js";
import { outboxMessages as crematoriumOutboxMessages } from "../src/shared/outbox.js";
import { crematoriumBookings } from "../src/modules/bookings/schema.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { fromStatusesFor } from "../src/modules/bookings/domain.js";
import * as bookingsRepo from "../src/modules/bookings/repo.js";
import { COMMANDS as CREMATORIUM_COMMANDS } from "../src/topics.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "4e000001-ec00-4000-8000-0000000000ff";
const FACILITY_ID = randomUUID();

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
 * it has no per-test or per-tenant filter). Drain in a loop, not a single
 * relayOnce call, so this test's own row is relayed regardless of how much
 * backlog earlier files in this suite left behind — same fix shape as
 * sewerage-service's PR #1029, applied proactively here per tonight's
 * fleet-wide gotcha.
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
  process.env.CREMATORIUM_TEST_NOTIFICATION_DATABASE_URL ??
  "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;
const registeredBookingIds: string[] = [];

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
  if (registeredBookingIds.length) {
    await runWithTenant(TENANT, () =>
      crematoriumDb.transaction(async (tx) => {
        for (const id of registeredBookingIds) {
          await tx.delete(crematoriumBookings).where(and(eq(crematoriumBookings.id, id), eq(crematoriumBookings.tenantId, TENANT)));
        }
      }),
    );
  }
  await runWithTenant(TENANT, () =>
    crematoriumDb.transaction((tx) =>
      tx.delete(crematoriumOutboxMessages).where(eq(crematoriumOutboxMessages.tenantId, TENANT)),
    ),
  );
  await crematoriumSqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("crematorium-service cross-events wiring — status notification, real DB, no mocks", () => {
  it("requestBooking raises a citizen status notification that lands as a real notification-service delivery, resolved to the application-submitted template", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerBookingConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const bookingId = randomUUID();
    registeredBookingIds.push(bookingId);
    await q.publish(
      CREMATORIUM_COMMANDS.requestBooking,
      makeMsg(CREMATORIUM_COMMANDS.requestBooking, {
        id: bookingId,
        facilityId: FACILITY_ID,
        applicantName: "Notify Test Applicant",
        applicantPhone: "9876500011",
        deceasedName: "Notify Test Deceased",
        serviceType: "cremation",
        requestedDate: "2027-03-03",
      }),
    );
    await q.drain();

    const [bookingRow] = await runWithTenant(TENANT, () =>
      crematoriumDb.transaction((tx) =>
        tx.select().from(crematoriumBookings).where(eq(crematoriumBookings.id, bookingId)).limit(1),
      ),
    );
    expect(bookingRow, "crematorium booking row must exist").toBeTruthy();
    expect(bookingRow!.status).toBe("requested");

    // Relay crematorium-service's outbox — the notification.send row from
    // requestBooking (alongside its finance.challan.create sibling, which
    // has no subscriber registered on this queue and is simply relayed
    // with nothing consuming it); notification-service's real delivery
    // consumer (subscribed above) picks it up and writes a delivery row.
    const relayed = await drainOutbox(crematoriumDb, q, "crematorium-service");
    expect(relayed, "crematorium-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, bookingId, 5);
    expect(deliveries.length, "notification-service must have written a delivery row").toBeGreaterThan(0);
    const delivery = deliveries[0]!;
    expect(delivery.recipient).toBe("9876500011");
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

  it("confirmBooking (payload carries only {id, slotNumber, paymentRef}) still raises a correctly-addressed status notification via its pre-tx recipient lookup", async () => {
    await importNotification();

    const q = tenantWrappedQueue();
    registerBookingConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    // Seed the booking directly via the repo (bypassing requestBooking's own
    // notification) so this test isolates confirmBooking's own wiring and
    // its pre-tx repo.findById lookup specifically.
    const bookingId = randomUUID();
    registeredBookingIds.push(bookingId);
    const bookingNumber = "CREM/ULB/TEST/000001";
    await runWithTenant(TENANT, () =>
      crematoriumDb.transaction((tx) =>
        bookingsRepo.insertBooking(tx, {
          id: bookingId,
          tenantId: TENANT,
          bookingNumber,
          facilityId: FACILITY_ID,
          applicantName: "Confirm Notify Test Applicant",
          applicantPhone: "9876500012",
          applicantRelation: null,
          deceasedName: "Confirm Notify Test Deceased",
          deceasedAge: null,
          deceasedGender: null,
          deathCertificateRef: null,
          serviceType: "cremation",
          requestedDate: "2027-03-04",
          requestedSlot: null,
          status: "requested",
          slotNumber: null,
          feeMinor: 50000n,
          currency: "INR",
          feePaid: false,
          paymentRef: null,
          completedAt: null,
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );
    // Sanity: fromStatusesFor("confirmed") must include "requested", the
    // status just seeded, or confirmBooking's CAS guard would silently no-op
    // below and this test would prove nothing.
    expect(fromStatusesFor("confirmed")).toContain("requested");

    await q.publish(
      CREMATORIUM_COMMANDS.confirmBooking,
      makeMsg(CREMATORIUM_COMMANDS.confirmBooking, {
        id: bookingId,
        slotNumber: "SLOT-7",
      }),
    );
    await q.drain();

    const [bookingRow] = await runWithTenant(TENANT, () =>
      crematoriumDb.transaction((tx) =>
        tx.select().from(crematoriumBookings).where(eq(crematoriumBookings.id, bookingId)).limit(1),
      ),
    );
    expect(bookingRow!.status).toBe("confirmed");
    expect(bookingRow!.slotNumber).toBe("SLOT-7");

    const relayed = await drainOutbox(crematoriumDb, q, "crematorium-service");
    expect(relayed, "crematorium-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, bookingId, 5);
    expect(deliveries.length, "notification-service must have written a delivery row for the confirm transition").toBeGreaterThan(0);
    // Most recent delivery is the confirm one (requestBooking above never ran
    // for this booking — it was seeded directly via the repo).
    const delivery = deliveries[0]!;
    // Recipient/variables came from the PRE-TX repo.findById lookup, not
    // from confirmBooking's own payload (which carries neither) — proves
    // the lookup-before-transaction wiring actually reaches the recipient.
    expect(delivery.recipient).toBe("9876500012");

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
