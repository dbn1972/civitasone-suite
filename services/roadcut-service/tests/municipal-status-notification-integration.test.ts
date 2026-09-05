/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * roadcut-service's applicant-status notification wiring
 * (modules/applications/consumer.ts submitApplication -> emitMunicipalNotification,
 * shared/cross-events.ts) produces a real notification.send outbox message
 * that a real notification-service consumer resolves against the real
 * municipal.application.submitted template (migration
 * 0044_municipal_templates.sql) and persists on a real delivery row.
 *
 * Same dual-DSN dynamic-import technique as
 * municipal-fee-challan-integration.test.ts in this directory (and
 * services/building-service/tests/municipal-status-notification-integration.test.ts):
 * roadcut's shared/db.ts and notification-service's shared/db.ts each
 * capture process.env.DATABASE_URL synchronously at first import (see
 * packages/db/src/create-tenant-db.ts), so this file flips DATABASE_URL
 * between dynamic imports to give each service its own real connection in
 * one process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, isNotNull } from "drizzle-orm";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";
import { outboxMessages as roadcutOutboxMessages } from "../src/shared/outbox.js";

/**
 * relayOnce fetches the OLDEST `batch` unpublished rows service-wide
 * (ORDER BY created_at ASC LIMIT batch — see packages/outbox/src/index.ts;
 * it has no per-test or per-tenant filter). roadcut-service's OTHER
 * integration test files exercise these same consumers heavily and never
 * relay their own outbox debt — a single relayOnce(..., 100, ...) call can
 * silently miss this test's own fresh row behind that backlog (same finding
 * as fire-service/sewerage-service's equivalent tests). Drain in a loop
 * instead, so this test's own row is relayed regardless of how much backlog
 * earlier files left behind.
 */
async function drainOutbox(db: unknown, queue: { publish: (...a: never[]) => unknown }, service: string): Promise<number> {
  const { relayOnce } = await import("@civitasone/outbox");
  let total = 0;
  for (let i = 0; i < 50; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await relayOnce(db as any, queue as any, 500, service);
    total += n;
    if (n === 0) break;
  }
  return total;
}

const PGPORT = process.env.ROADCUT_TEST_PGPORT ?? "5443";
const ROADCUT_DSN = `postgres://roadcut_svc:roadcut_dev_pw@localhost:${PGPORT}/civitas_roadcut`;
const NOTIFICATION_DSN = `postgres://notification_svc:notification_dev_pw@localhost:${PGPORT}/civitas_notification`;

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ff000005-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let roadcut: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notification: any;

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = ROADCUT_DSN;
  const roadcutDb = await import("../src/shared/db.js");
  const roadcutConsumer = await import("../src/modules/applications/consumer.js");
  const queuePkg = await import("@civitasone/queue");
  roadcut = { db: roadcutDb.db, sqlClient: roadcutDb.sqlClient, queue: new queuePkg.MemoryQueue() };
  roadcutConsumer.registerApplicationConsumers(roadcut.queue);

  process.env.DATABASE_URL = NOTIFICATION_DSN;
  // notification-service's deliveries consumer encrypts recipient PII at
  // rest (field-level encryptedText/blindIndex) and hard-errors without a
  // real key/salt outside its own vitest.config.ts (which sets these for
  // notification-service's OWN test run only — this file dynamically
  // imports notification-service's modules from a different service's test
  // process, so they must be set here too). Same values notification-
  // service's vitest.config.ts uses, and the same fix applied in
  // fire-service's identical cross-service test.
  process.env.NOTIFICATION_PII_KEY = process.env.NOTIFICATION_PII_KEY ?? "test_notification_pii_key_32chars";
  process.env.NOTIFICATION_PII_SALT = process.env.NOTIFICATION_PII_SALT ?? "civitas-notification-pii-test";
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
  // tenantWrappedQueue helper) -- wrap it onto roadcut's SAME queue so the
  // relayed message reaches it correctly tenant-scoped.
  const rawSubscribe = roadcut.queue.subscribe.bind(roadcut.queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roadcut.queue.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => notification.runWithTenant(msg.tenantId, () => handler(msg)));
  deliveryConsumer.registerDeliveryConsumers(roadcut.queue);

  await roadcut.queue.start();
});

afterAll(async () => {
  // Clear this test's own published outbox rows so they don't add to the
  // backlog other test files' drainOutbox loops have to wade through on a
  // later run against the same (non-fresh) container.
  const dbPkg = await import("@civitasone/db");
  await dbPkg.withTenantScope(roadcut.db, TENANT, (tx: any) =>
    tx.delete(roadcutOutboxMessages).where(and(eq(roadcutOutboxMessages.tenantId, TENANT), isNotNull(roadcutOutboxMessages.publishedAt))),
  ).catch(() => {});
  await roadcut.queue.stop();
  await roadcut.sqlClient.end();
  await notification.sqlClient.end();
});

describe("roadcut-service -> notification-service applicant status notification -- real DB, no mocks", () => {
  it("submitApplication relays into a real notification-service delivery row on the correct resolved template", async () => {
    const applicationId = randomUUID();

    await roadcut.queue.publish("roadcut.application.create", makeMsg("roadcut.application.create", {
      id: applicationId,
      tenantId: TENANT,
      applicantName: "Status Notification Integration Test",
      purpose: "water_pipe",
      location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
      roadType: "local",
      cuttingLength: "2",
      cuttingWidth: "2",
      cuttingDepth: "1",
    }));
    await roadcut.queue.drain();

    await roadcut.queue.publish("roadcut.application.submit", makeMsg("roadcut.application.submit", { id: applicationId, tenantId: TENANT }));
    await roadcut.queue.drain();

    // roadcut's REAL outbox now holds TWO pending notification.send messages
    // for this applicationId: createApplication's earlier municipal.fee.due
    // notification (never relayed above -- only roadcut.application.create's
    // COMMAND was drained, not its OUTBOX row) and submitApplication's
    // municipal.application.submitted notification written just now, both in
    // the SAME transaction as their respective status writes -- relay them
    // exactly like the production relay would, in one batch, exactly like a
    // real relay cycle picking up whatever is pending would.
    const relayed = await drainOutbox(roadcut.db, roadcut.queue, "roadcut-service");
    expect(relayed, "roadcut's outbox must have pending notification.send messages").toBeGreaterThan(0);
    await roadcut.queue.drain();

    // Both notifications share recipientId = applicationId, so select by
    // template rather than trusting deliveries[0] -- the two sends race each
    // other through notification-service's consumer (relayOnce fans them out
    // concurrently), so which one lands the later `createdAt` is not
    // deterministic. Selecting the specific template under test is what
    // proves the applicant-submitted wiring, independent of that race.
    const deliveries = await notification.findByRecipient(TENANT, applicationId, 5);
    expect(deliveries.length, "notification-service's real deliveries consumer must have written delivery rows").toBeGreaterThan(0);
    const delivery = deliveries.find(
      (d: { templateId: string }) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted,
    );
    expect(delivery, "must have a delivery resolved to the municipal.application.submitted template").toBeTruthy();
    expect(delivery.recipient).toBe(ACTOR); // roadcut_applications.createdBy, resolved by the consumer's repo.findByIdInTx lookup
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
  });
});
