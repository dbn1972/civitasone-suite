/**
 * Cross-service integration test (real Postgres, no mocks): proves
 * building-service's finance-fee-challan wiring
 * (modules/applications/consumer.ts createApplication -> emitMunicipalFeeChallan,
 * shared/cross-events.ts) produces a real finance.challan.create outbox
 * message that a real finance-service consumer processes into a real GL
 * journal row, with the correct amount and a building -> finance back-link.
 *
 * Two real Postgres connections in one process: civitas_building (this
 * service's own application consumer + outbox) and civitas_finance
 * (finance-service's real treasury + GL consumers). createTenantDb
 * (packages/db/src/create-tenant-db.ts) reads process.env.DATABASE_URL
 * synchronously the moment each service's shared/db.ts module is first
 * evaluated, so this file sets DATABASE_URL to building's DSN and
 * dynamically imports building's modules (capturing it), then flips
 * DATABASE_URL to finance's DSN and dynamically imports finance's modules
 * (capturing that) -- mirroring how two independently deployed services
 * each open their own DB connection in production, sequenced into one
 * test process instead of two.
 *
 * Nothing here hand-constructs the finance.challan.create payload: it is
 * produced by building's REAL calculateFeeMinor + emitMunicipalFeeChallan,
 * relayed out of building's REAL outbox table exactly like the production
 * relay would, and processed by finance's REAL challanCreate + GL-posting
 * consumers against finance's REAL database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE } from "@civitasone/events";

// Matches the CI/nightly convention (.github/workflows/nightly.yml uses
// finance_svc@.../civitas_finance on the standing dev container's port);
// this test's own bootstrap container is addressed via BUILDING_TEST_PGPORT.
const PGPORT = process.env.BUILDING_TEST_PGPORT ?? "5442";
const BUILDING_DSN = `postgres://building_svc:building_dev_pw@localhost:${PGPORT}/civitas_building`;
const FINANCE_DSN = `postgres://finance_svc:finance_dev_pw@localhost:${PGPORT}/civitas_finance`;

// Platform default tenant -- finance-service migration
// 0070_municipal_cross_service_challan.sql seeds the 0075 municipal-fee
// receipt head for exactly this tenant (see finance-service's own
// municipal-challan-integration.test.ts), so reusing it here needs no
// extra fixture setup on the finance side.
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "cc000002-ec00-4000-8000-0000000000ff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let building: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finance: any;

const queue = new MemoryQueue();

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

beforeAll(async () => {
  process.env.DATABASE_URL = BUILDING_DSN;
  const buildingDb = await import("../src/shared/db.js");
  const buildingConsumer = await import("../src/modules/applications/consumer.js");
  const dbPkg = await import("@civitasone/db");
  building = { db: buildingDb.db, sqlClient: buildingDb.sqlClient, withTenantScope: dbPkg.withTenantScope };
  // registerApplicationConsumers wraps subscriptions itself via
  // shared/tenant-queue.js's tenantScoped(), so the raw queue is enough here.
  buildingConsumer.registerApplicationConsumers(queue);

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
  // so a message published once reaches both building's and finance's
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
  // own municipal-challan-integration.test.ts), except 0075 which migration
  // 0070 already seeds (proving that migration, not re-creating its work).
  await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
    tx.insert(finance.financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: "1100", name: "Bank (building-service fee-challan integration test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );
});

afterAll(async () => {
  await queue.stop();
  await building.sqlClient.end();
  await finance.sqlClient.end();
});

describe("building-service -> finance-service municipal fee challan -- real DB, no mocks", () => {
  it("migration 0070 seeded the 0075 municipal-fee receipt head for the platform tenant", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();
  });

  it("createApplication raises a real fee challan, relayed end-to-end into a real finance-service GL journal row", async () => {
    const [seededHead] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeHeads)
        .where(and(eq(finance.financeHeads.tenantId, TENANT), eq(finance.financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE)))
        .limit(1),
    );

    const applicationId = randomUUID();
    // calculateFeeMinor: 500000n base + floor((250-200)/50)*100000n (built-up
    // area over 200) + (3-2)*200000n (floors over 2) = 800000n (Rs 8,000).
    await queue.publish("building.application.create", makeMsg("building.application.create", {
      id: applicationId,
      tenantId: TENANT,
      siteAddress: { line1: "12 MG Road", city: "Test City", pin: "560001" },
      plotArea: 300,
      builtUpArea: 250,
      proposedFloors: 3,
    }));
    await queue.drain();

    // ── Hop 1: building's REAL outbox holds the finance.challan.create
    // message emitMunicipalFeeChallan wrote, in the SAME transaction as the
    // application row (this is what the production outbox relay ships). ──
    const relayedFromBuilding = await relayOnce(building.db as never, queue, 100, "building-service");
    expect(relayedFromBuilding, "building's outbox must have a pending finance.challan.create message").toBeGreaterThan(0);
    await queue.drain();

    // ── Hop 2: finance's challanCreate consumer wrote the challan row and
    // enqueued the GL-post hop on FINANCE's own outbox; relay that too. ──
    const relayedFromFinance = await relayOnce(finance.db as never, queue, 100, "finance-service");
    expect(relayedFromFinance, "finance's outbox must have a pending GL-post message").toBeGreaterThan(0);
    await queue.drain();

    // ── The challan row: resolved head, correct amount, real back-link ──
    const [challanRow] = await finance.withTenantScope(finance.db, TENANT, (tx: any) =>
      tx.select().from(finance.financeChallans)
        .where(and(eq(finance.financeChallans.sourceService, "building"), eq(finance.financeChallans.sourceRef, applicationId)))
        .limit(1),
    );
    expect(challanRow, "a real finance_challans row must exist, back-linked to this building application").toBeTruthy();
    expect(challanRow.receiptHeadId).toBe(seededHead.id);
    expect(challanRow.amountMinor).toBe(800000n);
    expect(challanRow.depositor).toBe(ACTOR);
    expect(challanRow.sourceService).toBe("building");
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
    expect(creditLine.creditMinor).toBe("800000");
    expect(debitLine.debitMinor).toBe("800000");
    expect(creditLine.accountCode).toBe(seededHead.id);
  });
});
