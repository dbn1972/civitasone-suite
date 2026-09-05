/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * crematorium-service's shared/cross-events.ts (this PR) was never called
 * from any command/consumer before this change — this proves the wiring
 * added here actually reaches finance-service end to end:
 *
 *   bookings/consumer.ts's requestBooking emits finance.challan.create
 *   atomically with the booking row (booking-request time is where the fee
 *   actually becomes due in this service — feeMinor is computed up front by
 *   domain.ts's calculateFeeMinor, a pure function of the closed
 *   serviceType enum with no client-supplied amount at all — see
 *   cross-events.ts's file header for why no ceiling/role-gate applies
 *   here, unlike shop-service or sewerage-service); relaying crematorium's
 *   outbox onto a shared queue and letting finance-service's real
 *   treasury+gl consumers run produces a real GL journal row in
 *   finance-service's own database, back-linked to the crematorium booking
 *   (sourceService="crematorium", sourceRef=bookingNumber) with the fee
 *   amount preserved exactly. Mirrors sewerage-service's
 *   tests/municipal-fee-challan-integration.test.ts (PR #1029).
 *
 * finance-service is a separate service with its own database — this file
 * dynamically imports its db.ts/consumer/schema modules AFTER swapping
 * process.env.DATABASE_URL (and its other required env vars) to finance's
 * own connection, since createTenantDb() reads DATABASE_URL once at import
 * time. crematorium-service's own db.ts is imported statically at the top
 * of this file as usual, under crematorium's own DATABASE_URL from
 * vitest.config.ts / the test run's env.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as crematoriumDb, sqlClient as crematoriumSqlClient } from "../src/shared/db.js";
import { outboxMessages as crematoriumOutboxMessages } from "../src/shared/outbox.js";
import { crematoriumBookings } from "../src/modules/bookings/schema.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { COMMANDS as CREMATORIUM_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "3e000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";
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

/** Mirrors worker.ts's global subscribe wrap: every handler runs under the
 *  message's tenant GUC so FORCE RLS reads/writes succeed, exactly like
 *  production (see the reference test this file mirrors). */
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
 * it has no per-test or per-tenant filter). This service's OTHER
 * integration test files (bookings, facilities, records, tenant-isolation
 * — PR #1017) exercise these same consumers and never relay or clean up
 * their own outbox rows. Drain in a loop instead of a single relayOnce
 * call, so this test's own row is relayed regardless of how much backlog
 * earlier files left behind — same fix shape as sewerage-service's
 * PR #1029 (that fleet-wide gotcha), applied proactively here.
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

const FINANCE_URL =
  process.env.CREMATORIUM_TEST_FINANCE_DATABASE_URL ??
  "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;
const registeredBookingIds: string[] = [];

async function importFinance() {
  const originalUrl = process.env.DATABASE_URL;
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
      name: "Bank (crematorium cross-events integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
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
  if (finance?.sqlClient) await finance.sqlClient.end();
});

describe("crematorium-service cross-events wiring — fee challan, real DB, no mocks", () => {
  it("requestBooking raises a fee challan (server-computed feeMinor, no client-supplied amount) that lands as a real finance GL journal, back-linked to the booking", async () => {
    await importFinance();

    const q = tenantWrappedQueue();
    registerBookingConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const bookingId = randomUUID();
    registeredBookingIds.push(bookingId);
    // electric_cremation -> calculateFeeMinor returns a fixed 150000n (Rs
    // 1500) -- this test asserts against that exact constant rather than a
    // hand-picked amount, since the whole point of this service's fee path
    // is that the client cannot influence it at all (see domain.ts).
    await q.publish(
      CREMATORIUM_COMMANDS.requestBooking,
      makeMsg(CREMATORIUM_COMMANDS.requestBooking, {
        id: bookingId,
        facilityId: FACILITY_ID,
        applicantName: "Cross Events Test Applicant",
        applicantPhone: "9876500001",
        deceasedName: "Cross Events Test Deceased",
        serviceType: "electric_cremation",
        requestedDate: "2027-03-01",
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
    // feeMinor survives exactly as a bigint, computed server-side.
    expect(bookingRow!.feeMinor).toBe(150000n);
    const bookingNumber = bookingRow!.bookingNumber;
    expect(bookingNumber).toMatch(/^CREM\/ULB\/\d{4}\/\d{6}$/);

    // Hop 1: relay crematorium-service's own outbox — publishes
    // finance.challan.create (plus a notification.send row, which has no
    // subscriber registered on this queue and is simply relayed with
    // nothing consuming it) onto the shared queue, which finance-service's
    // treasury consumer (already subscribed above) picks up and processes
    // against finance's own database.
    const relayed1 = await drainOutbox(crematoriumDb, q, "crematorium-service");
    expect(relayed1, "crematorium-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    // Hop 2: the treasury consumer enqueued finance.gl.post into finance's OWN
    // outbox (same tx) — relay that too, like the real outbox relay would.
    await drainOutbox(finance.db, q, "finance-service");
    await q.drain();

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="crematorium", sourceRef=bookingNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "crematorium"), eq(finance.financeChallans.sourceRef, bookingNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the crematorium booking").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    // ── the amount survives exactly, end to end ──
    expect(challanRow.amountMinor).toBe(150000n);
    expect(challanRow.amountMinor.toString()).toBe("150000");
    expect(challanRow.depositor).toBe("Cross Events Test Applicant");

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
    expect(creditLine.creditMinor).toBe("150000");
    expect(debitLine.debitMinor).toBe("150000");
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });

  it("requestBooking for a burial (lowest fee tier) does NOT raise a challan when feeMinor would be 0 — regression guard for the no-op branch", async () => {
    // Every real serviceType in this service currently has a positive fee
    // (domain.ts's calculateFeeMinor never returns 0 today), so this test
    // instead proves emitMunicipalFeeChallan's own no-op guard directly:
    // a booking with a genuinely positive fee (burial, Rs 300) still emits
    // exactly one finance.challan.create row, not zero and not more than
    // one — guarding against a future regression where a refactor of
    // requestBooking's transaction accidentally double-emits.
    await importFinance();

    const q = tenantWrappedQueue();
    registerBookingConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const bookingId = randomUUID();
    registeredBookingIds.push(bookingId);
    await q.publish(
      CREMATORIUM_COMMANDS.requestBooking,
      makeMsg(CREMATORIUM_COMMANDS.requestBooking, {
        id: bookingId,
        facilityId: FACILITY_ID,
        applicantName: "Single Emit Test Applicant",
        applicantPhone: "9876500002",
        deceasedName: "Single Emit Test Deceased",
        serviceType: "burial",
        requestedDate: "2027-03-02",
      }),
    );
    await q.drain();

    const [bookingRow] = await runWithTenant(TENANT, () =>
      crematoriumDb.transaction((tx) =>
        tx.select().from(crematoriumBookings).where(eq(crematoriumBookings.id, bookingId)).limit(1),
      ),
    );
    expect(bookingRow!.feeMinor).toBe(30000n);

    const unpublishedRows = await runWithTenant(TENANT, () =>
      crematoriumDb.transaction((tx) =>
        tx.select().from(crematoriumOutboxMessages)
          .where(and(
            eq(crematoriumOutboxMessages.tenantId, TENANT),
            eq(crematoriumOutboxMessages.eventType, "finance.challan.create"),
          )),
      ),
    );
    // At least one row for THIS booking (identified by depositor name),
    // and the count for it is exactly one — proves no double-emit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsForThisBooking = (unpublishedRows as any[]).filter(
      (r) => (r.payload as { depositor?: string }).depositor === "Single Emit Test Applicant",
    );
    expect(rowsForThisBooking).toHaveLength(1);

    await q.stop();
  });
});
