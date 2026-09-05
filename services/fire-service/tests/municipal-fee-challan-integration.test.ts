/**
 * Wave 3 cross-service wiring integration test (real Postgres, no mocks).
 *
 * fire-service's shared/cross-events.ts (this PR) was never called from any
 * command/consumer before this change — this proves the wiring added here
 * actually reaches finance-service end to end:
 *
 *   applications/consumer.ts's createApplication emits finance.challan.create
 *   atomically with the application row (fee-assessment time is where the
 *   fire-safety NOC fee actually becomes due — see that handler's own
 *   comment); relaying fire-service's outbox onto a shared queue and letting
 *   finance-service's real treasury+gl consumers run produces a real GL
 *   journal row in finance-service's own database, back-linked to the fire
 *   application (sourceService="fire", sourceRef=applicationNumber) with the
 *   fee amount preserved exactly. Mirrors
 *   finance-service/tests/municipal-challan-integration.test.ts and
 *   sewerage-service/tests/municipal-fee-challan-integration.test.ts.
 *
 * Uses a large-but-valid builtUpArea (850,000 sqft — a large industrial
 * complex) rather than a trivial test value, so the resulting fee
 * (Rs 4,30,000.00 = 43,000,000 paise: the 500000-paise industrial base +
 * 850000 sqft * 50 paise/sqft) meaningfully exercises the bigint/string
 * money codec end to end, comfortably under this service's own
 * MAX_FEE_CHALLAN_AMOUNT_MINOR ceiling.
 *
 * finance-service is a separate service with its own database — this file
 * dynamically imports its db.ts/consumer/schema modules AFTER swapping
 * process.env.DATABASE_URL (and its other required env vars) to finance's
 * own connection, since createTenantDb() reads DATABASE_URL once at import
 * time. fire-service's own db.ts is imported statically at the top of this
 * file as usual, under fire-service's own DATABASE_URL from
 * vitest.config.ts / the test run's env.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

import { db as fireDb, sqlClient as fireSqlClient } from "../src/shared/db.js";
import { outboxMessages as fireOutboxMessages } from "../src/shared/outbox.js";
import { fireApplicationsTable } from "../src/modules/applications/schema.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { COMMANDS as FIRE_COMMANDS } from "../src/topics.js";

// Platform default tenant — the same tenant finance-service's migration 0070
// seeds the 0075 municipal-fee receipt head for (see
// finance-service/tests/municipal-challan-integration.test.ts), so this test
// exercises the real seeded head rather than a hand-rolled substitute.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "3e000001-fc00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

// Rs 4,30,000.00 in paise: industrial base fee (500000) + 850,000 sqft *
// 50 paise/sqft (42,500,000) — see applications/domain.ts's
// calculateFeeMinor and BASE_FEE_PAISE.industrial.
const BUILT_UP_AREA_SQFT = "850000";
const EXPECTED_FEE_MINOR = 500000n + 850000n * 50n; // 43,000,000n

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
 * it has no per-test or per-tenant filter). fire-service's OTHER
 * integration test files (PR #1011's 57-test real-DB suite) exercise these
 * same consumers heavily and never relay their own outbox debt — a single
 * relayOnce(..., 100, ...) call can silently miss this test's own fresh row
 * behind that backlog (verified against a real Postgres container, same
 * finding as sewerage-service/parking-service's equivalent tests). Drain in
 * a loop instead, so this test's own row is relayed regardless of how much
 * backlog earlier files left behind.
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
  process.env.FIRE_TEST_FINANCE_DATABASE_URL ??
  "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;
const registeredApplicationIds: string[] = [];

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
      name: "Bank (fire cross-events integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
  process.env.DATABASE_URL = originalUrl;
}

afterAll(async () => {
  if (registeredApplicationIds.length) {
    await runWithTenant(TENANT, () =>
      fireDb.transaction(async (tx) => {
        for (const id of registeredApplicationIds) {
          await tx.delete(fireApplicationsTable).where(and(eq(fireApplicationsTable.id, id), eq(fireApplicationsTable.tenantId, TENANT)));
        }
      }),
    );
  }
  await runWithTenant(TENANT, () =>
    fireDb.transaction((tx) =>
      tx.delete(fireOutboxMessages).where(eq(fireOutboxMessages.tenantId, TENANT)),
    ),
  );
  await fireSqlClient.end();
  if (finance?.sqlClient) await finance.sqlClient.end();
});

describe("fire-service cross-events wiring — fee challan, real DB, no mocks", () => {
  it("createApplication raises a fee challan that lands as a real finance GL journal, back-linked to the application, preserving a large amount exactly", async () => {
    await importFinance();

    const q = tenantWrappedQueue();
    registerApplicationConsumers(q);
    finance.registerTreasuryConsumers(q);
    finance.registerGlConsumers(q);
    await q.start();

    const applicationId = randomUUID();
    registeredApplicationIds.push(applicationId);
    await q.publish(
      FIRE_COMMANDS.createApplication,
      makeMsg(FIRE_COMMANDS.createApplication, {
        id: applicationId,
        buildingName: "Riverside Industrial Complex",
        buildingAddress: { line1: "Plot 12, MIDC Estate", city: "Pune", pin: "411018" },
        occupancyType: "industrial",
        builtUpArea: BUILT_UP_AREA_SQFT,
      }),
    );
    await q.drain();

    const [appRow] = await runWithTenant(TENANT, () =>
      fireDb.transaction((tx) =>
        tx.select().from(fireApplicationsTable).where(eq(fireApplicationsTable.id, applicationId)).limit(1),
      ),
    );
    expect(appRow, "fire application row must exist").toBeTruthy();
    expect(appRow!.status).toBe("draft");
    // feeMinor survives exactly as a bigint — no JS number in the path.
    expect(appRow!.feeMinor).toBe(EXPECTED_FEE_MINOR);
    const applicationNumber = appRow!.applicationNumber;

    // Hop 1: relay fire-service's own outbox — publishes
    // finance.challan.create (plus a notification.send row, which has no
    // subscriber registered on this queue and is simply relayed with
    // nothing consuming it) onto the shared queue, which finance-service's
    // treasury consumer (already subscribed above) picks up and processes
    // against finance's own database.
    const relayed1 = await drainOutbox(fireDb, q, "fire-service");
    expect(relayed1, "fire-service must have an unpublished finance.challan.create row to relay").toBeGreaterThan(0);
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

    // ── back-link: sourceService="fire", sourceRef=applicationNumber ──
    const [challanRow] = await withTenantScope(finance.db as never, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "fire"), eq(finance.financeChallans.sourceRef, applicationNumber)))
        .limit(1),
    );
    expect(challanRow, "finance-service must have created a challan row back-linked to the fire application").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    // ── the amount survives exactly, end to end ──
    expect(challanRow.amountMinor).toBe(EXPECTED_FEE_MINOR);
    expect(challanRow.amountMinor.toString()).toBe(EXPECTED_FEE_MINOR.toString());
    expect(challanRow.depositor).toBe("Riverside Industrial Complex");

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
    expect(creditLine.creditMinor).toBe(EXPECTED_FEE_MINOR.toString());
    expect(debitLine.debitMinor).toBe(EXPECTED_FEE_MINOR.toString());
    expect(creditLine.accountCode).toBe(seededHead.id);

    await q.stop();
  });
});
