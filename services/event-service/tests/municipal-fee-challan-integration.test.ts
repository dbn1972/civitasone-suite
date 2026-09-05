/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * event-service's finance-fee-challan wiring
 * (modules/applications/consumer.ts createApplication -> emitMunicipalFeeChallan,
 * shared/cross-events.ts) produces a real finance.challan.create outbox
 * message that a real finance-service consumer processes into a real GL
 * journal row, with the correct combined fee+deposit amount and an
 * event -> finance back-link.
 *
 * Same dual-DSN dynamic-import technique as
 * building-service/tests/municipal-fee-challan-integration.test.ts: two real
 * Postgres connections in one process (civitas_event and civitas_finance).
 * createTenantDb (packages/db/src/create-tenant-db.ts) reads
 * process.env.DATABASE_URL synchronously the moment each service's
 * shared/db.ts module is first evaluated, so this file sets DATABASE_URL to
 * event's DSN and dynamically imports event's modules (capturing it), then
 * flips DATABASE_URL to finance's DSN and dynamically imports finance's
 * modules (capturing that).
 *
 * Nothing here hand-constructs the finance.challan.create payload: it is
 * produced by event's REAL calculateFeeMinor/calculateDepositMinor +
 * emitMunicipalFeeChallan, relayed out of event's REAL outbox table exactly
 * like the production relay would, and processed by finance's REAL
 * challanCreate + GL-posting consumers against finance's REAL database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

/**
 * event-service's own tests/applications.test.ts, nocs.test.ts,
 * permits.test.ts and post_event.test.ts hit a real Postgres DB and never
 * truncate afterward (by design -- they predate this Wave 3 wiring and rely
 * on unique random UUIDs per run, not isolation). Now that
 * createApplication/etc. also write real _outbox.messages rows, those runs
 * leave real, permanently-unpublished garbage in the SAME table this file's
 * relayOnce() calls scan -- confirmed directly against this test's own dev
 * container: 115+ unrelated TENANT_A rows accumulated from earlier full-suite
 * runs, none with a seeded receipt head, so a single relayOnce(limit=100)
 * call can fill its entire batch with that garbage and never reach the one
 * row this test actually published. Draining to completion (instead of
 * trusting a single bounded relayOnce call) guarantees this test's own
 * message is eventually reached regardless of how much unrelated garbage
 * precedes it -- same fix shape as building-service PR #1035's outbox-leak
 * fix, applied here at the read side instead of the write side since the
 * garbage source (pre-existing, unrelated real-DB tests) isn't something
 * this PR should be modifying just to satisfy this file's own assertions.
 */
async function relayToCompletion(db: unknown, queue: unknown, batchLimit: number, source: string): Promise<number> {
  let total = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await relayOnce(db as never, queue as any, batchLimit, source);
    total += n;
    if (n === 0) return total;
  }
}

const PGPORT = process.env.EVENT_TEST_PGPORT ?? "5444";
const EVENT_DSN = `postgres://event_svc:event_dev_pw@localhost:${PGPORT}/civitas_event`;
const FINANCE_DSN = `postgres://finance_svc:finance_dev_pw@localhost:${PGPORT}/civitas_finance`;

// Platform default tenant -- finance-service migration
// 0070_municipal_cross_service_challan.sql seeds the 0075 municipal-fee
// receipt head for exactly this tenant (see finance-service's own
// municipal-challan-integration.test.ts and building-service's
// municipal-fee-challan-integration.test.ts), so reusing it here needs no
// extra fixture setup on the finance side.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ee000004-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let event: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;

const queue = new MemoryQueue();

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = EVENT_DSN;
  const eventDb = await import("../src/shared/db.js");
  const eventConsumer = await import("../src/modules/applications/consumer.js");
  const dbPkg = await import("@civitasone/db");
  event = { db: eventDb.db, sqlClient: eventDb.sqlClient, withTenantScope: dbPkg.withTenantScope };
  // registerApplicationConsumers wraps subscriptions itself via
  // shared/tenant-queue.js's tenantScoped(), so the raw queue is enough here.
  eventConsumer.registerApplicationConsumers(queue);

  process.env.DATABASE_URL = FINANCE_DSN;
  const financeDb = await import("../../finance-service/src/shared/db.js");
  const treasuryConsumer = await import("../../finance-service/src/modules/treasury/consumer.js");
  const glConsumer = await import("../../finance-service/src/modules/gl/consumer.js");
  const treasurySchema = await import("../../finance-service/src/modules/treasury/schema.js");
  const glSchema = await import("../../finance-service/src/modules/gl/schema.js");
  const budgetSchema = await import("../../finance-service/src/modules/budget/schema.js");
  const spine = await import("../../finance-service/src/modules/gl/spine.js");
  const dbPkg2 = await import("@civitasone/db");
  finance = {
    db: financeDb.db, sqlClient: financeDb.sqlClient,
    financeChallans: treasurySchema.financeChallans,
    financeJournals: glSchema.financeJournals,
    financeHeads: budgetSchema.financeHeads,
    deterministicId: spine.deterministicId,
    withTenantScope: dbPkg2.withTenantScope,
    runWithTenant: dbPkg2.runWithTenant,
  };
  // finance's own consumers do NOT self-wrap for tenant scoping -- wrap
  // them onto the SAME underlying queue so a message published once reaches
  // both event's and finance's handlers correctly tenant-scoped.
  const rawSubscribe = queue.subscribe.bind(queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => finance.runWithTenant(msg.tenantId, () => handler(msg)));
  treasuryConsumer.registerTreasuryConsumers(queue);
  glConsumer.registerGlConsumers(queue);

  await queue.start();

  // Bank head (1100) is not seeded by any migration for this tenant -- the
  // challanCreate consumer resolves it by code exactly like it resolves the
  // municipal fee head, so it is a test fixture here (same as
  // building-service's own municipal-fee-challan-integration.test.ts),
  // except 0075 which migration 0070 already seeds (proving that
  // migration, not re-creating its work).
  await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
    tx.insert(finance.financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: "1100", name: "Bank (event-service fee-challan integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
});

afterAll(async () => {
  await queue.stop();
  await event.sqlClient.end();
  await finance.sqlClient.end();
});

describe("event-service -> finance-service municipal fee challan -- real DB, no mocks", () => {
  it("migration 0070 seeded the 0075 municipal-fee receipt head for the platform tenant", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();
  });

  it("createApplication raises a real combined fee+deposit challan, relayed end-to-end into a real finance-service GL journal row", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );

    const applicationId = randomUUID();
    // calculateFeeMinor("cultural", attendance=600, soundPermission=true):
    //   base 500000n + floor((600-500)/100)*50000n (attendance over 500) = 550000n
    //   + 200000n (sound permission) = 750000n
    // calculateDepositMinor(attendance=600): 500 < 600 <= 1000 -> 2500000n
    // combined (applications/consumer.ts's totalDueMinor) = 750000n + 2500000n = 3250000n
    await queue.publish("event.application.create", makeMsg("event.application.create", {
      id: applicationId,
      tenantId: TENANT,
      organiserName: "Test Organiser",
      organiserPhone: "9999999999",
      eventType: "cultural",
      venueName: "Test Grounds",
      venueAddress: { line1: "1 Test Rd", city: "Test City", pin: "560001" },
      startDate: "2026-12-01T00:00:00.000Z",
      endDate: "2026-12-01T23:00:00.000Z",
      expectedAttendance: 600,
      soundPermission: true,
    }));
    await queue.drain();

    // ── Hop 1: event's REAL outbox holds the finance.challan.create
    // message emitMunicipalFeeChallan wrote, in the SAME transaction as the
    // application row (this is what the production outbox relay ships). ──
    const relayedFromEvent = await relayToCompletion(event.db, queue, 100, "event-service");
    expect(relayedFromEvent, "event's outbox must have a pending finance.challan.create message").toBeGreaterThan(0);
    await queue.drain();

    // ── Hop 2: finance's challanCreate consumer wrote the challan row and
    // enqueued the GL-post hop on FINANCE's own outbox; relay that too. ──
    const relayedFromFinance = await relayToCompletion(finance.db, queue, 100, "finance-service");
    expect(relayedFromFinance, "finance's outbox must have a pending GL-post message").toBeGreaterThan(0);
    await queue.drain();

    // ── The challan row: resolved head, correct combined amount, real back-link ──
    const [challanRow] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "event"), eq(finance.financeChallans.sourceRef, applicationId)))
        .limit(1),
    );
    expect(challanRow, "a real finance_challans row must exist, back-linked to this event application").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(3250000n);
    expect(challanRow.depositor).toBe(ACTOR);
    expect(challanRow.sourceService).toBe("event");
    expect(challanRow.sourceRef).toBe(applicationId);

    // ── A real GL journal row, correctly balanced, credited to the head ──
    const journalId = finance.deterministicId(`challan:${challanRow.id}`);
    const [journalRow] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeJournals).where(eq(finance.financeJournals.id, journalId)).limit(1),
    );
    expect(journalRow, "GL journal row must have been posted by the second hop (finance.gl.post)").toBeTruthy();
    expect(journalRow.lines).toHaveLength(2);
    const creditLine = journalRow.lines.find((l: { creditMinor: string }) => l.creditMinor !== "0");
    const debitLine = journalRow.lines.find((l: { debitMinor: string }) => l.debitMinor !== "0");
    expect(creditLine.creditMinor).toBe("3250000");
    expect(debitLine.debitMinor).toBe("3250000");
    expect(creditLine.accountCode).toBe(seededHead.id);
  });
});
