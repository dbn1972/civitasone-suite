/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * roadcut-service's finance-fee-challan wiring
 * (modules/applications/consumer.ts createApplication -> emitMunicipalFeeChallan,
 * shared/cross-events.ts) produces a real finance.challan.create outbox
 * message that a real finance-service consumer processes into a real GL
 * journal row, with the correct amount and a roadcut -> finance back-link.
 *
 * Two real Postgres connections in one process: civitas_roadcut (this
 * service's own application consumer + outbox) and civitas_finance
 * (finance-service's real treasury + GL consumers). createTenantDb
 * (packages/db/src/create-tenant-db.ts) reads process.env.DATABASE_URL
 * synchronously the moment each service's shared/db.ts module is first
 * evaluated, so this file sets DATABASE_URL to roadcut's DSN and
 * dynamically imports roadcut's modules (capturing it), then flips
 * DATABASE_URL to finance's DSN and dynamically imports finance's modules
 * (capturing that) -- same dual-DSN dynamic-import technique as
 * services/building-service/tests/municipal-fee-challan-integration.test.ts.
 *
 * Nothing here hand-constructs the finance.challan.create payload: it is
 * produced by roadcut's REAL calculateFeeMinor + emitMunicipalFeeChallan,
 * relayed out of roadcut's REAL outbox table exactly like the production
 * relay would, and processed by finance's REAL challanCreate + GL-posting
 * consumers against finance's REAL database.
 *
 * Deliberately does NOT assert anything about `depositMinor` — roadcut's
 * cross-events.ts intentionally does not raise a finance.challan.create for
 * the refundable restoration security deposit (see that file's header);
 * this test only proves the road-cutting fee itself is wired correctly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, isNotNull } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";
import { outboxMessages as roadcutOutboxMessages } from "../src/shared/outbox.js";

/**
 * relayOnce fetches the OLDEST `batch` unpublished rows service-wide
 * (ORDER BY created_at ASC LIMIT batch — see packages/outbox/src/index.ts;
 * it has no per-test or per-tenant filter). roadcut-service's OTHER
 * integration test files (applications/permits/restoration/inspections/
 * tenant-isolation/number-uniqueness) exercise these same consumers
 * heavily and never relay their own outbox debt — a single
 * relayOnce(..., 100, ...) call can silently miss this test's own fresh row
 * behind that backlog (same finding as fire-service/sewerage-service's
 * equivalent tests, PR #1011 and after). Drain in a loop instead, so this
 * test's own row is relayed regardless of how much backlog earlier files
 * left behind.
 */
async function drainOutbox(db: unknown, queue: MemoryQueue, service: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = await relayOnce(db as any, queue, 500, service);
    total += n;
    if (n === 0) break;
  }
  return total;
}

// Matches the CI/nightly convention (.github/workflows/nightly.yml uses
// finance_svc@.../civitas_finance on the standing dev container's port);
// this test's own bootstrap container is addressed via ROADCUT_TEST_PGPORT.
const PGPORT = process.env.ROADCUT_TEST_PGPORT ?? "5443";
const ROADCUT_DSN = `postgres://roadcut_svc:roadcut_dev_pw@localhost:${PGPORT}/civitas_roadcut`;
const FINANCE_DSN = `postgres://finance_svc:finance_dev_pw@localhost:${PGPORT}/civitas_finance`;

// Platform default tenant -- finance-service migration
// 0070_municipal_cross_service_challan.sql seeds the 0075 municipal-fee
// receipt head for exactly this tenant, so reusing it here needs no extra
// fixture setup on the finance side.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "ee000004-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let roadcut: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;

const queue = new MemoryQueue();

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = ROADCUT_DSN;
  const roadcutDb = await import("../src/shared/db.js");
  const roadcutConsumer = await import("../src/modules/applications/consumer.js");
  const dbPkg = await import("@civitasone/db");
  roadcut = { db: roadcutDb.db, sqlClient: roadcutDb.sqlClient, withTenantScope: dbPkg.withTenantScope };
  // registerApplicationConsumers wraps subscriptions itself via
  // shared/tenant-queue.js's tenantScoped(), so the raw queue is enough here.
  roadcutConsumer.registerApplicationConsumers(queue);

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
  // finance's own consumers do NOT self-wrap for tenant scoping (see
  // finance-service/tests/municipal-challan-integration.test.ts's
  // tenantWrappedQueue helper) -- wrap them onto the SAME underlying queue
  // so a message published once reaches both roadcut's and finance's
  // handlers correctly tenant-scoped.
  const rawSubscribe = queue.subscribe.bind(queue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (queue as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => finance.runWithTenant(msg.tenantId, () => handler(msg)));
  treasuryConsumer.registerTreasuryConsumers(queue);
  glConsumer.registerGlConsumers(queue);

  await queue.start();

  // Bank head (1100) is not seeded by any migration for this tenant — the
  // challanCreate consumer resolves it by code exactly like it resolves the
  // municipal fee head, so it is a test fixture here (same as finance-service's
  // own municipal-challan-integration.test.ts and building-service's), except
  // 0075 which migration 0070 already seeds (proving that migration, not
  // re-creating its work).
  await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
    tx.insert(finance.financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: "1100", name: "Bank (roadcut-service fee-challan integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
});

afterAll(async () => {
  // Clear this test's own published outbox rows so they don't add to the
  // backlog other test files' drainOutbox loops have to wade through on a
  // later run against the same (non-fresh) container.
  await roadcut.withTenantScope(roadcut.db, TENANT, (tx: any) =>
    tx.delete(roadcutOutboxMessages).where(and(eq(roadcutOutboxMessages.tenantId, TENANT), isNotNull(roadcutOutboxMessages.publishedAt))),
  ).catch(() => {});
  await queue.stop();
  await roadcut.sqlClient.end();
  await finance.sqlClient.end();
});

describe("roadcut-service -> finance-service municipal fee challan -- real DB, no mocks", () => {
  it("migration 0070 seeded the 0075 municipal-fee receipt head for the platform tenant", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();
  });

  it("createApplication raises a real fee challan (never the deposit), relayed end-to-end into a real finance-service GL journal row", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );

    const applicationId = randomUUID();
    // calculateFeeMinor (local road, default rate): area = 4*5 = 20 sqm;
    // 100000n paise/sqm -> feeMinor = 2,000,000 paise (Rs 20,000).
    // calculateDepositMinor: 200000n paise/sqm -> depositMinor = 4,000,000
    // paise (Rs 40,000) -- deliberately never challaned, see cross-events.ts.
    await queue.publish("roadcut.application.create", makeMsg("roadcut.application.create", {
      id: applicationId,
      tenantId: TENANT,
      applicantName: "Fee Challan Integration Test",
      purpose: "water_pipe",
      location: { latitude: 18.52, longitude: 73.85, address: "1 Test St" },
      roadType: "local",
      cuttingLength: "4",
      cuttingWidth: "5",
      cuttingDepth: "1",
    }));
    await queue.drain();

    // ── Hop 1: roadcut's REAL outbox holds the finance.challan.create
    // message emitMunicipalFeeChallan wrote, in the SAME transaction as the
    // application row (this is what the production outbox relay ships).
    // Drained in a loop (see drainOutbox) rather than trusting one
    // relayOnce call, since this service's other test files leave their own
    // outbox debt behind. ──
    const relayedFromRoadcut = await drainOutbox(roadcut.db, queue, "roadcut-service");
    expect(relayedFromRoadcut, "roadcut's outbox must have a pending finance.challan.create message").toBeGreaterThan(0);
    await queue.drain();

    // ── Hop 2: finance's challanCreate consumer wrote the challan row and
    // enqueued the GL-post hop on FINANCE's own outbox; relay that too. ──
    const relayedFromFinance = await drainOutbox(finance.db, queue, "finance-service");
    expect(relayedFromFinance, "finance's outbox must have a pending GL-post message").toBeGreaterThan(0);
    await queue.drain();

    // ── The challan row: resolved head, correct amount (fee, NOT deposit), real back-link ──
    const [challanRow] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "roadcut"), eq(finance.financeChallans.sourceRef, applicationId)))
        .limit(1),
    );
    expect(challanRow, "a real finance_challans row must exist, back-linked to this roadcut application").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(2000000n);
    expect(challanRow.depositor).toBe(ACTOR);
    expect(challanRow.sourceService).toBe("roadcut");
    expect(challanRow.sourceRef).toBe(applicationId);

    // Exactly one challan row for this application — proves the security
    // deposit (4,000,000n) was never separately challaned.
    const allChallansForApp = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "roadcut"), eq(finance.financeChallans.sourceRef, applicationId))),
    );
    expect(allChallansForApp).toHaveLength(1);

    // ── A real GL journal row, correctly balanced, credited to the head ──
    const journalId = finance.deterministicId(`challan:${challanRow.id}`);
    const [journalRow] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeJournals).where(eq(finance.financeJournals.id, journalId)).limit(1),
    );
    expect(journalRow, "GL journal row must have been posted by the second hop (finance.gl.post)").toBeTruthy();
    expect(journalRow.lines).toHaveLength(2);
    const creditLine = journalRow.lines.find((l: { creditMinor: string }) => l.creditMinor !== "0");
    const debitLine = journalRow.lines.find((l: { debitMinor: string }) => l.debitMinor !== "0");
    expect(creditLine.creditMinor).toBe("2000000");
    expect(debitLine.debitMinor).toBe("2000000");
    expect(creditLine.accountCode).toBe(seededHead.id);
  });
});
