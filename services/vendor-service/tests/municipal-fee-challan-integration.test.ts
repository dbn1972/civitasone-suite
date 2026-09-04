/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * vendor-service's shared/cross-events.ts (this PR) was never called from
 * any command/consumer before this change — this proves the wiring added
 * here actually reaches finance-service end to end:
 *
 *   licences/consumer.ts's issueLicence emits finance.challan.create
 *   atomically with the licence row (NOT at createRegistration/
 *   submitRegistration — see issueLicence's own comment for why licence
 *   issuance is where the fee actually becomes due in this service);
 *   relaying vendor's outbox onto a shared queue and letting
 *   finance-service's real treasury+gl consumers run produces a real GL
 *   journal row in finance-service's own database, back-linked to the
 *   vendor licence (sourceService="vendor", sourceRef=licenceId) with the
 *   fee amount preserved exactly. Mirrors
 *   finance-service/tests/municipal-challan-integration.test.ts and
 *   shop-service/tests/cross-events-integration.test.ts.
 *
 * finance-service is a separate service with its own database — this file
 * dynamically imports its db.ts/consumer/schema modules AFTER swapping
 * process.env.DATABASE_URL (and its other required env vars) to finance's
 * own connection, since createTenantDb() reads DATABASE_URL once at import
 * time. vendor-service's own db.ts is imported statically at the top of
 * this file as usual, under vendor's own DATABASE_URL from
 * vitest.config.ts / the test run's env.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as vendorDb, sqlClient as vendorSqlClient } from "../src/shared/db.js";
import { outboxMessages as vendorOutboxMessages } from "../src/shared/outbox.js";
import { vendorRegistrations } from "../src/modules/registrations/schema.js";
import { vendorLicences } from "../src/modules/licences/schema.js";
import { registerRegistrationConsumers } from "../src/modules/registrations/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { COMMANDS as VENDOR_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ee000001-ec00-4000-8000-0000000000ff";
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

const FINANCE_URL =
  process.env.VENDOR_TEST_FINANCE_DATABASE_URL ??
  "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;
let registeredLicenceIds: string[] = [];
let registeredRegistrationIds: string[] = [];

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
      name: "Bank (vendor cross-events integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
  process.env.DATABASE_URL = originalUrl;
}

afterAll(async () => {
  if (registeredLicenceIds.length) {
    await runWithTenant(TENANT, () =>
      vendorDb.transaction(async (tx) => {
        for (const id of registeredLicenceIds) {
          await tx.delete(vendorLicences).where(and(eq(vendorLicences.id, id), eq(vendorLicences.tenantId, TENANT)));
        }
      }),
    );
  }
  if (registeredRegistrationIds.length) {
    await runWithTenant(TENANT, () =>
      vendorDb.transaction(async (tx) => {
        for (const id of registeredRegistrationIds) {
          await tx.delete(vendorRegistrations).where(and(eq(vendorRegistrations.id, id), eq(vendorRegistrations.tenantId, TENANT)));
        }
      }),
    );
  }
  await runWithTenant(TENANT, () =>
    vendorDb.transaction((tx) =>
      tx.delete(vendorOutboxMessages).where(eq(vendorOutboxMessages.tenantId, TENANT)),
    ),
  );
  await vendorSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
});

describe("vendor-service cross-events wiring — fee challan, real DB, no mocks", () => {
  it("issueLicence raises a fee challan that lands as a real finance GL journal, back-linked to the licence", async () => {
    await importFinance();

    const q = tenantWrappedQueue();
    registerRegistrationConsumers(q);
    registerCommitteeConsumers(q);
    registerLicenceConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const registrationId = randomUUID();
    registeredRegistrationIds.push(registrationId);
    await q.publish(
      VENDOR_COMMANDS.createRegistration,
      makeMsg(VENDOR_COMMANDS.createRegistration, {
        id: registrationId,
        tenantId: TENANT,
        vendorName: "Ramesh Street Foods",
        vendorAadhaar: "123456789012",
        vendorPhone: "9876543210",
        category: "food",
      }),
    );
    await q.drain();

    await q.publish(
      VENDOR_COMMANDS.approveRegistration,
      makeMsg(VENDOR_COMMANDS.approveRegistration, { registrationId, tenantId: TENANT }),
    );
    await q.drain();

    const [regRow] = await runWithTenant(TENANT, () =>
      vendorDb.transaction((tx) =>
        tx.select().from(vendorRegistrations).where(eq(vendorRegistrations.id, registrationId)).limit(1),
      ),
    );
    expect(regRow, "vendor registration row must exist").toBeTruthy();
    expect(regRow!.status).toBe("approved");
    expect(regRow!.feeMinor).toBeGreaterThan(0n); // "food" category -> Rs 1,000 (100000n paise)

    const licenceId = randomUUID();
    registeredLicenceIds.push(licenceId);
    await q.publish(
      VENDOR_COMMANDS.issueLicence,
      makeMsg(VENDOR_COMMANDS.issueLicence, {
        id: licenceId,
        tenantId: TENANT,
        registrationId,
        zone: "Zone-A",
        spotNumber: "A-14",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      }),
    );
    await q.drain();

    // Hop 1: relay vendor-service's own outbox — publishes finance.challan.create
    // (plus notification.send rows, which have no subscriber registered on
    // this queue and are simply relayed with nothing consuming them) onto the
    // shared queue, which finance-service's treasury consumer (already
    // subscribed above) picks up and processes against finance's own database.
    const relayed1 = await relayOnce(vendorDb as never, q, 100, "vendor-service");
    expect(relayed1, "vendor-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
    await q.drain();

    // Hop 2: the treasury consumer enqueued finance.gl.post into finance's OWN
    // outbox (same tx) — relay that too, like the real outbox relay would.
    await relayOnce(finance.db as never, q, 100, "finance-service");
    await q.drain();

    const [licenceRow] = await runWithTenant(TENANT, () =>
      vendorDb.transaction((tx) =>
        tx.select().from(vendorLicences).where(eq(vendorLicences.id, licenceId)).limit(1),
      ),
    );
    expect(licenceRow, "vendor licence row must exist").toBeTruthy();
    expect(licenceRow!.status).toBe("active");

    const [seededHead] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // ── back-link: sourceService="vendor", sourceRef=licenceId ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "vendor"), eq(finance.financeChallans.sourceRef, licenceId)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the vendor licence").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(regRow!.feeMinor);
    expect(challanRow.depositor).toBe("Ramesh Street Foods");

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
});
