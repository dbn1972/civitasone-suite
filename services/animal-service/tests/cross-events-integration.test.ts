/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * animal-service's shared/cross-events.ts was ported but never called from
 * any command/consumer until this change — this proves the wiring added
 * here actually reaches the receiving services end to end, mirroring
 * shop-service's tests/cross-events-integration.test.ts (PR #1021):
 *
 *   1. registration/consumer.ts's registerAnimal emits
 *      finance.challan.create atomically with the registration row (fee
 *      derived server-side from domain.ts's calculateRegistrationFee, a
 *      fixed animal-type schedule — never a client-supplied amount);
 *      relaying animal-service's outbox onto a shared queue and letting
 *      finance-service's real treasury+gl consumers run produces a real GL
 *      journal row in finance-service's own database, back-linked to the
 *      animal registration (sourceService="animal",
 *      sourceRef=registrationNumber) with the fee amount preserved exactly.
 *   2. complaints/consumer.ts's reportComplaint emits notification.send
 *      atomically with the complaint row; relaying it into
 *      notification-service's real deliveries consumer produces a real
 *      delivery row resolved to the municipal.application.submitted
 *      template (reused here as the "request received" acknowledgement,
 *      same reuse sewerage-service applied to its own complaintCreate).
 *   3. complaints/consumer.ts's dispatchTeam — whose command payload
 *      carries only {id, tenantId}, no reportedBy/complaintNumber — proves
 *      the pre-tx recipient-lookup pattern (PR #1028's gotcha) actually
 *      resolves to a second, distinct notification.send lands as a real
 *      delivery row resolved to the municipal.status.changed template.
 *
 * finance-service and notification-service are separate services with
 * their own databases — this file dynamically imports their db.ts/
 * consumer/schema modules AFTER swapping process.env.DATABASE_URL (and
 * their other required env vars) to each service's own connection, since
 * createTenantDb() reads DATABASE_URL once at import time. animal-service's
 * own db.ts is imported statically at the top of this file as usual, under
 * animal's own DATABASE_URL from vitest.config.ts / the test run's env.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE, SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

import { db as animalDb, sqlClient as animalSqlClient } from "../src/shared/db.js";
import { outboxMessages as animalOutboxMessages } from "../src/shared/outbox.js";
import { animalRegistrations } from "../src/modules/registration/schema.js";
import { animalComplaints } from "../src/modules/complaints/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registration/consumer.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { COMMANDS as ANIMAL_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts and
// shop-service's cross-events-integration.test.ts), so this test exercises
// the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "aa000001-ec00-4000-8000-0000000000ff";
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

/**
 * Drain-to-completion wrapper around relayOnce, not a single fixed-batch
 * call. relayOnce's own query (packages/outbox/src/index.ts) selects
 * unpublished rows with NO tenant/service scoping at all — the oldest
 * `batch` rows across the WHOLE outbox table, full stop. animal-service's
 * six pre-existing test files (registration-lifecycle, complaints-lifecycle,
 * complaints-cas, registration-cas, tenant-isolation, operations) all
 * exercise consumers that enqueue real domain-event outbox rows and never
 * relay or delete them, so this shared, persistent civitas_animal database
 * accumulates an ever-growing backlog of unpublished rows across every test
 * run (confirmed: 200+ and climbing). A single relayOnce(db, q, 100, ...)
 * call only ever claims the 100 OLDEST such rows (ORDER BY createdAt ASC
 * LIMIT batch) — once the backlog exceeds the batch size, THIS test's own
 * freshly-created finance.challan.create/notification.send row sorts behind
 * it and is never selected, which is exactly the flakiness this test hit
 * running after the suite's other files: it passed reliably in isolation
 * (empty backlog) and failed reliably as part of the full suite on a second
 * or later run (backlog > batch). Looping relayOnce until it returns 0
 * drains the entire backlog every time, at the (harmless) cost of also
 * publishing those other files' unrelated domain-event rows onto this
 * test's private queue `q`, which registers only this file's own
 * consumers — an event topic with no matching subscriber here is simply
 * marked published with no effect, the same non-issue shop-service's own
 * cross-events-integration.test.ts already documents inline for its
 * finance-challan hop.
 */
async function drainRelay(db: unknown, q: MemoryQueue, service: string): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await relayOnce(db as never, q, 500, service);
    if (n === 0) return total;
    total += n;
  }
}

const FINANCE_URL = process.env.ANIMAL_TEST_FINANCE_DATABASE_URL
  ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";
const NOTIFICATION_URL = process.env.ANIMAL_TEST_NOTIFICATION_DATABASE_URL
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
      name: "Bank (animal cross-events integration test)",
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
    animalDb.transaction(async (tx) => {
      await tx.delete(animalRegistrations).where(eq(animalRegistrations.tenantId, TENANT));
      await tx.delete(animalComplaints).where(eq(animalComplaints.tenantId, TENANT));
      await tx.delete(animalOutboxMessages).where(eq(animalOutboxMessages.tenantId, TENANT));
    }),
  );
  // finance-service and notification-service are shared, persistent
  // databases (not reset between test runs like animal-service's own rows
  // above) — this test uses the real seeded "platform default tenant" (see
  // TENANT's comment), so leftover rows from a previous run of this exact
  // file would otherwise sit there indefinitely and, worse, contaminate a
  // later run's own assertions (a query with no filter tighter than
  // tenantId/recipientId can return an OLD row instead of the one this run
  // just created — this is exactly what happened before this cleanup was
  // added: reportComplaint's assertion intermittently observed a stale
  // municipal.status.changed delivery left behind by a prior run instead of
  // its own fresh municipal.application.submitted one).
  if (finance?.db && finance?.financeChallans) {
    await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.delete(finance.financeChallans).where(eq(finance.financeChallans.sourceService, "animal")),
    );
  }
  if (notification?.db) {
    const { notificationDeliveries } = await import("../../notification-service/src/modules/deliveries/schema.js");
    await withTenantScope(notification.db as never, TENANT, (tx: any) =>
      tx.delete(notificationDeliveries).where(eq(notificationDeliveries.tenantId, TENANT)),
    );
  }
  await animalSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
  if (notification?.sqlClient) await notification.sqlClient.end();
});

describe("animal-service cross-events wiring — real DB, no mocks", () => {
  it("registerAnimal raises a fee challan that lands as a real finance GL journal, back-linked to the registration", async () => {
    const q = tenantWrappedQueue();
    registerRegistrationConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const registrationId = randomUUID();
    await q.publish(
      ANIMAL_COMMANDS.registerAnimal,
      makeMsg(ANIMAL_COMMANDS.registerAnimal, {
        id: registrationId,
        tenantId: TENANT,
        ownerName: "Fee Challan Test Owner",
        ownerPhone: "9876500001",
        ownerAddress: { line1: "1 Test Road", city: "Pune", pin: "411001" },
        animalType: "dog",
      }),
    );
    await q.drain();

    // Hop 1: relay animal-service's own outbox — publishes
    // finance.challan.create onto the shared queue, which finance-service's
    // treasury consumer (already subscribed above) picks up and processes
    // against finance's own database.
    const relayed1 = await drainRelay(animalDb, q, "animal-service");
    expect(relayed1, "animal-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    // Hop 2: the treasury consumer enqueued finance.gl.post into finance's OWN
    // outbox (same tx) — relay that too, like the real outbox relay would.
    await drainRelay(finance.db, q, "finance-service");
    await q.drain();

    const [regRow] = await runWithTenant(TENANT, () =>
      animalDb.transaction((tx) =>
        tx.select().from(animalRegistrations).where(eq(animalRegistrations.id, registrationId)).limit(1),
      ),
    );
    expect(regRow, "animal registration row must exist").toBeTruthy();
    expect(regRow!.feeMinor).toBe(50000n); // dog fee, see domain.ts calculateRegistrationFee

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="animal", sourceRef=registrationNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "animal"), eq(finance.financeChallans.sourceRef, regRow!.registrationNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the animal registration").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(regRow!.feeMinor);

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
    expect(creditLine.creditMinor).toBe(regRow!.feeMinor.toString());
    expect(debitLine.debitMinor).toBe(regRow!.feeMinor.toString());
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });

  it("reportComplaint raises a citizen acknowledgement that lands as a real notification-service delivery", async () => {
    const q = tenantWrappedQueue();
    registerComplaintConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const complaintId = randomUUID();
    await q.publish(
      ANIMAL_COMMANDS.reportComplaint,
      makeMsg(ANIMAL_COMMANDS.reportComplaint, {
        id: complaintId,
        tenantId: TENANT,
        location: { address: "Near Test Chowk", ward: "Ward 7" },
        animalType: "dog",
        complaintType: "stray",
        severity: "medium",
      }),
    );
    await q.drain();

    const relayed = await drainRelay(animalDb, q, "animal-service");
    expect(relayed, "animal-service must have an unpublished notification.send row to relay").toBeGreaterThan(0);
    await q.drain();

    const [complaintRow] = await runWithTenant(TENANT, () =>
      animalDb.transaction((tx) =>
        tx.select().from(animalComplaints).where(eq(animalComplaints.id, complaintId)).limit(1),
      ),
    );
    expect(complaintRow, "animal complaint row must exist").toBeTruthy();

    // findByRecipient returns every delivery ever sent to this ACTOR across
    // every run of this suite against this shared, persistent
    // notification-service database — match on the complaint's own
    // reference number (unique per real DB sequence value) rather than
    // assuming index 0 is this run's row, so a leftover delivery from an
    // earlier run can never be mistaken for this one.
    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, ACTOR, 50);
    const delivery = deliveries.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d: any) => d.recipient === complaintRow!.complaintNumber,
    );
    expect(delivery, "notification-service must have written a delivery row for this complaint's reference number").toBeTruthy();
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

  it("dispatchTeam (payload carries no reportedBy/complaintNumber) resolves the pre-tx recipient lookup into a real status-changed delivery", async () => {
    const q = tenantWrappedQueue();
    registerComplaintConsumers(q);
    notification.registerDeliveryConsumers(q);
    await q.start();

    const complaintId = randomUUID();
    await q.publish(
      ANIMAL_COMMANDS.reportComplaint,
      makeMsg(ANIMAL_COMMANDS.reportComplaint, {
        id: complaintId,
        tenantId: TENANT,
        location: { address: "Near Dispatch Test Chowk", ward: "Ward 3" },
        animalType: "dangerous",
        complaintType: "bite",
        severity: "high",
      }),
    );
    await q.drain();
    // Drain + relay the acknowledgement notification from reportComplaint too,
    // so it doesn't linger unpublished and confuse the relay-count assertion
    // below.
    await drainRelay(animalDb, q, "animal-service");
    await q.drain();

    await q.publish(
      ANIMAL_COMMANDS.assignComplaint,
      makeMsg(ANIMAL_COMMANDS.assignComplaint, {
        id: complaintId, tenantId: TENANT, assignedTo: ACTOR, assignedTeam: "animal_control",
      }),
    );
    await q.drain();

    // assignComplaint is deliberately not notification-wired (internal
    // workflow step) — relay its (empty) outbox contribution away so it
    // doesn't affect the dispatch-hop relay-count assertion below.
    await drainRelay(animalDb, q, "animal-service");
    await q.drain();

    await q.publish(
      ANIMAL_COMMANDS.dispatchTeam,
      makeMsg(ANIMAL_COMMANDS.dispatchTeam, { id: complaintId, tenantId: TENANT }),
    );
    await q.drain();

    const [complaintRow] = await runWithTenant(TENANT, () =>
      animalDb.transaction((tx) =>
        tx.select().from(animalComplaints).where(eq(animalComplaints.id, complaintId)).limit(1),
      ),
    );
    expect(complaintRow!.status).toBe("dispatched");

    const relayed = await drainRelay(animalDb, q, "animal-service");
    expect(relayed, "animal-service must have an unpublished notification.send row from dispatchTeam to relay").toBeGreaterThan(0);
    await q.drain();

    // notificationDeliveries carries no `variables` column (that payload
    // detail lives only in the outbox message, already relayed away), and
    // findByRecipient returns every delivery ever sent to this ACTOR across
    // every run of this suite against this shared, persistent
    // notification-service database — so the dispatch-hop delivery for THIS
    // run's complaint is identified by matching BOTH its own reference
    // number (unique per real DB sequence value, immune to leftover rows
    // from a previous run) AND the municipal.status.changed template
    // (distinguishing it from this same complaint's own earlier
    // municipal.application.submitted acknowledgement).
    const deliveries = await notification.deliveriesRepo.findByRecipient(TENANT, ACTOR, 50);
    const statusChangedDelivery = deliveries.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d: any) => d.recipient === complaintRow!.complaintNumber && d.templateId === SYSTEM_TEMPLATE_IDS.municipalStatusChanged,
    );
    expect(statusChangedDelivery, "notification-service must have a municipal.status.changed delivery from dispatchTeam for this complaint").toBeTruthy();

    const [templateRow] = await withTenantScope(notification.db as never, "00000000-0000-0000-0000-000000000000", (tx: any) =>
      tx.select().from(notification.notificationTemplates)
        .where(eq(notification.notificationTemplates.id, statusChangedDelivery.templateId))
        .limit(1),
    );
    expect(templateRow, "the resolved templateId must correspond to a real seeded template row").toBeTruthy();
    expect(templateRow.name).toBe("municipal.status.changed");

    await q.stop();
  });
});
