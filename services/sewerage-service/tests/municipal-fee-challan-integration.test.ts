/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * sewerage-service's shared/cross-events.ts (this PR) was never called from
 * any command/consumer before this change — this proves the wiring added
 * here actually reaches finance-service end to end:
 *
 *   billing/consumer.ts's billGenerate emits finance.challan.create
 *   atomically with the bill row (bill-generation time is where the fee
 *   actually becomes due in this service — see that handler's own comment);
 *   relaying sewerage's outbox onto a shared queue and letting
 *   finance-service's real treasury+gl consumers run produces a real GL
 *   journal row in finance-service's own database, back-linked to the
 *   sewerage bill (sourceService="sewerage", sourceRef=billNumber) with the
 *   fee amount preserved exactly. Mirrors
 *   finance-service/tests/municipal-challan-integration.test.ts and
 *   vendor-service/tests/municipal-fee-challan-integration.test.ts.
 *
 * Uses a large-but-valid amount (Rs 82,34,567.89, comfortably under this
 * service's own MAX_FEE_CHALLAN_AMOUNT_MINOR ceiling of Rs 1 crore) rather
 * than a trivial test amount — billing/schema.ts's amountMinor is a real
 * Postgres bigint (migrations/0002_money_bigint_paise.sql, PR #1014) and a
 * single/double-digit test value would not meaningfully exercise the
 * string->bigint codec this wiring depends on end to end.
 *
 * finance-service is a separate service with its own database — this file
 * dynamically imports its db.ts/consumer/schema modules AFTER swapping
 * process.env.DATABASE_URL (and its other required env vars) to finance's
 * own connection, since createTenantDb() reads DATABASE_URL once at import
 * time. sewerage-service's own db.ts is imported statically at the top of
 * this file as usual, under sewerage's own DATABASE_URL from
 * vitest.config.ts / the test run's env.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as sewerageDb, sqlClient as sewerageSqlClient } from "../src/shared/db.js";
import { outboxMessages as sewerageOutboxMessages } from "../src/shared/outbox.js";
import { sewerageBills } from "../src/modules/billing/schema.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { sewerageDesludgingBookings } from "../src/modules/desludging/schema.js";
import { registerDesludgingConsumers } from "../src/modules/desludging/consumer.js";
import { COMMANDS as SEWERAGE_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "1e000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

// Rs 82,34,567.89 in paise — large but comfortably under this service's own
// MAX_FEE_CHALLAN_AMOUNT_MINOR ceiling (Rs 1 crore, see shared/cross-events.ts).
const LARGE_AMOUNT_MINOR = "823456789";

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
 * relayOnce fetches the OLDEST `batch` unpublished rows service-wide
 * (ORDER BY created_at ASC LIMIT batch — see packages/outbox/src/index.ts;
 * it has no per-test or per-tenant filter). sewerage-service's OTHER
 * integration test files (hardening, routes-health, complaints-flow, ...)
 * exercise these same consumers extensively and never relay or clean up
 * their own audit.event.record/notification.send outbox rows — verified
 * against a real Postgres container: a single full-suite run left ~200
 * unpublished rows behind before this test's own row was even created. A
 * single relayOnce(..., 100, ...) call (this file's own reference
 * templates' convention) can silently miss this test's fresh row entirely
 * behind that backlog. Drain in a loop instead, so this test's own row is
 * relayed regardless of how much backlog earlier files left behind.
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
  process.env.SEWERAGE_TEST_FINANCE_DATABASE_URL ??
  "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;
const registeredBillIds: string[] = [];
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
      name: "Bank (sewerage cross-events integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
  process.env.DATABASE_URL = originalUrl;
}

afterAll(async () => {
  if (registeredBillIds.length) {
    await runWithTenant(TENANT, () =>
      sewerageDb.transaction(async (tx) => {
        for (const id of registeredBillIds) {
          await tx.delete(sewerageBills).where(and(eq(sewerageBills.id, id), eq(sewerageBills.tenantId, TENANT)));
        }
      }),
    );
  }
  if (registeredBookingIds.length) {
    await runWithTenant(TENANT, () =>
      sewerageDb.transaction(async (tx) => {
        for (const id of registeredBookingIds) {
          await tx.delete(sewerageDesludgingBookings).where(and(eq(sewerageDesludgingBookings.id, id), eq(sewerageDesludgingBookings.tenantId, TENANT)));
        }
      }),
    );
  }
  await runWithTenant(TENANT, () =>
    sewerageDb.transaction((tx) =>
      tx.delete(sewerageOutboxMessages).where(eq(sewerageOutboxMessages.tenantId, TENANT)),
    ),
  );
  await sewerageSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
});

describe("sewerage-service cross-events wiring — fee challan, real DB, no mocks", () => {
  it("billGenerate raises a fee challan that lands as a real finance GL journal, back-linked to the bill, preserving a large amount exactly", async () => {
    await importFinance();

    const q = tenantWrappedQueue();
    registerBillingConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const billId = randomUUID();
    registeredBillIds.push(billId);
    const connectionId = randomUUID();
    await q.publish(
      SEWERAGE_COMMANDS.billGenerate,
      makeMsg(SEWERAGE_COMMANDS.billGenerate, {
        id: billId,
        connectionId,
        billingPeriod: "2026-09",
        amountMinor: LARGE_AMOUNT_MINOR,
        dueDate: "2026-10-15",
      }),
    );
    await q.drain();

    const [billRow] = await runWithTenant(TENANT, () =>
      sewerageDb.transaction((tx) =>
        tx.select().from(sewerageBills).where(eq(sewerageBills.id, billId)).limit(1),
      ),
    );
    expect(billRow, "sewerage bill row must exist").toBeTruthy();
    expect(billRow!.status).toBe("generated");
    // amountMinor survives exactly as a bigint — no JS number in the path
    // (see billing/consumer.ts's billGenerate: BigInt(p.amountMinor)).
    expect(billRow!.amountMinor).toBe(BigInt(LARGE_AMOUNT_MINOR));
    const billNumber = billRow!.billNumber;

    // Hop 1: relay sewerage-service's own outbox — publishes
    // finance.challan.create (plus a notification.send row, which has no
    // subscriber registered on this queue and is simply relayed with
    // nothing consuming it) onto the shared queue, which finance-service's
    // treasury consumer (already subscribed above) picks up and processes
    // against finance's own database.
    const relayed1 = await drainOutbox(sewerageDb, q, "sewerage-service");
    expect(relayed1, "sewerage-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
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

    // ── back-link: sourceService="sewerage", sourceRef=billNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "sewerage"), eq(finance.financeChallans.sourceRef, billNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the sewerage bill").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    // ── the large amount survives exactly, end to end ──
    expect(challanRow.amountMinor).toBe(BigInt(LARGE_AMOUNT_MINOR));
    expect(challanRow.amountMinor.toString()).toBe(LARGE_AMOUNT_MINOR);
    expect(challanRow.depositor).toBe(billNumber);

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
    expect(creditLine.creditMinor).toBe(LARGE_AMOUNT_MINOR);
    expect(debitLine.debitMinor).toBe(LARGE_AMOUNT_MINOR);
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });

  it("desludgingBook (with an officer/admin-assessed feeMinor) raises a fee challan that lands as a real finance GL journal, back-linked to the booking", async () => {
    // Companion to the billGenerate test above, added alongside the fix for
    // the PR #1029 review gap (desludging/routes.ts now requires
    // ADMIN_ROLES to set feeMinor at all — see hardening.integration.
    // test.ts's "desludging feeMinor — citizen-set fee gap" block for the
    // HTTP-layer rejection). This test drives the command layer directly
    // (bypassing HTTP role checks, like billGenerate above) purely to prove
    // the cross-event wiring itself — desludgingBook -> emitMunicipalFeeChallan
    // -> a real finance GL journal — still works end to end for a
    // legitimate, officer-assessed fee once that gate is in place.
    await importFinance();

    const q = tenantWrappedQueue();
    registerDesludgingConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const bookingId = randomUUID();
    registeredBookingIds.push(bookingId);
    // A plausible tariff amount an inspecting officer would assess for a
    // mid-size tank (Rs 600), not a trivial single-digit value — exercises
    // the real string->bigint codec path the same way the billing test does.
    const assessedFeeMinor = "60000";
    await q.publish(
      SEWERAGE_COMMANDS.desludgingBook,
      makeMsg(SEWERAGE_COMMANDS.desludgingBook, {
        id: bookingId,
        requestedBy: ACTOR,
        address: null,
        tankCapacityLitres: 1000,
        requestedDate: null,
        requestedSlot: null,
        feeMinor: assessedFeeMinor,
      }),
    );
    await q.drain();

    const [bookingRow] = await runWithTenant(TENANT, () =>
      sewerageDb.transaction((tx) =>
        tx.select().from(sewerageDesludgingBookings).where(eq(sewerageDesludgingBookings.id, bookingId)).limit(1),
      ),
    );
    expect(bookingRow, "sewerage desludging booking row must exist").toBeTruthy();
    expect(bookingRow!.status).toBe("requested");
    expect(bookingRow!.feeMinor).toBe(BigInt(assessedFeeMinor));
    const bookingNumber = bookingRow!.bookingNumber;

    const relayed1 = await drainOutbox(sewerageDb, q, "sewerage-service");
    expect(relayed1, "sewerage-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    await drainOutbox(finance.db, q, "finance-service");
    await q.drain();

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="sewerage", sourceRef=bookingNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "sewerage"), eq(finance.financeChallans.sourceRef, bookingNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the desludging booking").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(BigInt(assessedFeeMinor));
    expect(challanRow.amountMinor.toString()).toBe(assessedFeeMinor);
    expect(challanRow.depositor).toBe(bookingNumber);

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
    expect(creditLine.creditMinor).toBe(assessedFeeMinor);
    expect(debitLine.debitMinor).toBe(assessedFeeMinor);
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });
});
