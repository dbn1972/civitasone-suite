/**
 * Cross-service integration test (real Postgres for advertisement-service,
 * finance-service AND notification-service — no mocks) for Wave 3's
 * cross-events wiring: services/advertisement-service/src/shared/cross-events.ts
 * (merged inert via PR #1008's hardening pass) is now actually called from
 * applications/consumer.ts, permits/consumer.ts and enforcement/consumer.ts.
 *
 * Proves the full real path, not just the payload shape:
 *   advertisement-service command -> advertisement-service consumer (real DB
 *   write) -> advertisement-service outbox -> relay -> finance-service /
 *   notification-service consumer (real DB write) -> (finance only) second
 *   relay hop -> GL consumer (real DB write).
 *
 * Mirrors services/finance-service/tests/municipal-challan-integration.test.ts
 * and services/trade-service/tests/cross-service-integration.test.ts (both
 * merged this wave) for the receiving-side assertions and DSN handling.
 *
 * finance-service and notification-service are loaded via dynamic import
 * with process.env.DATABASE_URL swapped to each service's own database
 * immediately before that import — each service's shared/db.ts binds its
 * Drizzle client from DATABASE_URL exactly once, at first import, so this is
 * how one vitest worker can host three services' DB singletons at once
 * without editing any of the three services' source. Restored to the
 * ACTUALLY-CAPTURED original DATABASE_URL afterward.
 *
 * DSN handling mirrors services/shop-service/tests/cross-events-integration.test.ts
 * and services/trade-service/tests/cross-service-integration.test.ts exactly:
 * env-overridable via ADVERTISEMENT_TEST_*_DATABASE_URL, falling back to a
 * default that matches CI's actual convention — one Postgres instance on
 * port 5435 (scripts/ci/bootstrap-postgres.sh's PGPORT), with per-service
 * databases/roles created by that same script. The fallback literals below
 * are copied byte-for-byte from finance-service's and notification-service's
 * own vitest.config.ts DATABASE_URL defaults.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantScope, runWithTenant } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE, SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

import { db as advDb, sqlClient as advSqlClient } from "../src/shared/db.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approvals/consumer.js";
import { registerPermitConsumers } from "../src/modules/permits/consumer.js";
import { registerEnforcementConsumers } from "../src/modules/enforcement/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { calculateFeeMinor } from "../src/modules/applications/domain.js";
import { advApplications } from "../src/modules/applications/schema.js";

const TENANT = "00000000-0000-0000-0000-000000000001"; // platform-default tenant — 0075 head already seeded (migration 0070)
const ACTOR = "ad000001-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

// actorId defaults to ACTOR but is overridable per call — each `it()` below
// uses its OWN fresh actor (see per-test `const actor = randomUUID()`) so
// that findByRecipient() lookups can never observe another test's delivery
// rows regardless of insertion-order/timestamp granularity, even though
// fileParallelism: false (vitest.config.ts) already serializes files against
// each other on the shared civitas_advertisement/civitas_notification DBs.
function makeMsg(type: string, payload: Record<string, unknown>, actorId: string = ACTOR) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

/**
 * relayOnce() (packages/outbox) selects unpublished rows GLOBALLY from
 * outbox_messages — oldest-created-first, up to `batch` — with no per-test
 * or per-tenant scoping. Against this manual-verification container (reused
 * across repeated `vitest run` invocations, unlike CI's always-fresh
 * bootstrap), earlier test files' own cross-events-wired writes leave their
 * own unpublished finance.challan.create/notification.send rows sitting in
 * the SAME table indefinitely (nothing in those files' own tests relays
 * them). A single relayOnce(..., batch=100) call can then spend its whole
 * budget on that older backlog and never reach THIS test's own row —
 * reproduced directly: the exact intermittent failure this helper fixes.
 * Loop relayOnce to full drain (returns 0) instead of trusting one call to
 * reach an arbitrary row, exactly like a production relay loop
 * (startRelay's own repeated-interval call to relayOnce) already does.
 */
async function relayAll(db: unknown, queue: MemoryQueue, service: string, maxIterations = 50): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxIterations; i++) {
    const n = await relayOnce(db as never, queue, 100, service);
    total += n;
    if (n === 0) break;
  }
  return total;
}

// Populated in beforeAll via dynamic import (see file header for why).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let financeDb: any, financeSqlClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let financeHeads: any, financeChallans: any, financeJournals: any, deterministicId: (key: string) => string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registerTreasuryConsumers: (q: unknown) => void, registerGlConsumers: (q: unknown) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notificationSqlClient: any, findByRecipient: (tenantId: string, recipientId: string, limit?: number) => Promise<Array<Record<string, unknown>>>;
let registerDeliveryConsumers: (q: unknown) => void;

// Env-overridable, CI-matching defaults — see file header.
const FINANCE_URL = process.env.ADVERTISEMENT_TEST_FINANCE_DATABASE_URL
  ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance";
const NOTIFICATION_URL = process.env.ADVERTISEMENT_TEST_NOTIFICATION_DATABASE_URL
  ?? "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification";

let q: MemoryQueue;

beforeAll(async () => {
  // Captured BEFORE any swapping — advertisement-service's own db.ts already
  // bound correctly at this file's static-import time, before any of this
  // runs, from whatever DATABASE_URL the test run itself was started with.
  const originalUrl = process.env.DATABASE_URL;

  // ── finance-service: bind its own db.ts singleton against civitas_finance,
  // then load its consumers/schema via relative cross-service imports.
  process.env.DATABASE_URL = FINANCE_URL;
  process.env.DB_URL = FINANCE_URL;
  process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_enc_key_for_finance_32c";
  const financeDbMod = await import("../../finance-service/src/shared/db.js");
  financeDb = financeDbMod.db;
  financeSqlClient = financeDbMod.sqlClient;
  ({ registerTreasuryConsumers } = await import("../../finance-service/src/modules/treasury/consumer.js"));
  ({ registerGlConsumers } = await import("../../finance-service/src/modules/gl/consumer.js"));
  ({ financeHeads } = await import("../../finance-service/src/modules/budget/schema.js"));
  ({ financeChallans } = await import("../../finance-service/src/modules/treasury/schema.js"));
  ({ financeJournals } = await import("../../finance-service/src/modules/gl/schema.js"));
  ({ deterministicId } = await import("../../finance-service/src/modules/gl/spine.js"));

  // ── notification-service: same technique against civitas_notification.
  process.env.DATABASE_URL = NOTIFICATION_URL;
  process.env.NOTIFICATION_PII_KEY = process.env.NOTIFICATION_PII_KEY ?? "test_notification_pii_key_32chars";
  process.env.NOTIFICATION_PII_SALT = process.env.NOTIFICATION_PII_SALT ?? "civitas-notification-pii-test";
  process.env.NOTIFICATION_EMAIL_DRIVER = process.env.NOTIFICATION_EMAIL_DRIVER ?? "stub";
  process.env.NOTIFICATION_IN_APP_DRIVER = process.env.NOTIFICATION_IN_APP_DRIVER ?? "memory";
  process.env.NOTIFICATION_SMS_DRIVER = process.env.NOTIFICATION_SMS_DRIVER ?? "stub";
  process.env.NOTIFICATION_WHATSAPP_DRIVER = process.env.NOTIFICATION_WHATSAPP_DRIVER ?? "stub";
  const notificationDbMod = await import("../../notification-service/src/shared/db.js");
  notificationSqlClient = notificationDbMod.sqlClient;
  ({ registerDeliveryConsumers } = await import("../../notification-service/src/modules/deliveries/consumer.js"));
  ({ findByRecipient } = await import("../../notification-service/src/modules/deliveries/repo.js"));

  // Restore the ACTUAL captured original.
  process.env.DATABASE_URL = originalUrl;

  // Fixture: the BANK_CODE control head isn't seeded by any migration for
  // this tenant — the treasury consumer resolves it by code exactly like it
  // resolves the municipal fee head (0075, which migration 0070 DID seed for
  // this tenant).
  await withTenantScope(financeDb, TENANT, (tx: never) =>
    (tx as typeof financeDb).insert(financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: BANK_CODE, name: "Bank (advertisement cross-service test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );

  // One shared in-process queue carries all three services' commands/events.
  // advertisement-service's own register*Consumers already tenant-scope
  // internally (tenantScoped(rawQueue) inside each function); finance's and
  // notification's consumer.ts files don't self-wrap, so they're registered
  // through the SAME tenantScoped() wrapper advertisement-service exports.
  q = new MemoryQueue();
  registerApplicationConsumers(q);
  registerApprovalConsumers(q);
  registerPermitConsumers(q);
  registerEnforcementConsumers(q);
  registerTreasuryConsumers(tenantScoped(q));
  registerGlConsumers(tenantScoped(q));
  registerDeliveryConsumers(tenantScoped(q));
  await q.start();
});

afterAll(async () => {
  await q.stop();
  await financeSqlClient.end({ timeout: 5 });
  await notificationSqlClient.end({ timeout: 5 });
  await advSqlClient.end({ timeout: 5 });
});

/**
 * Drives an application all the way through to an issued permit (create ->
 * submit -> scrutiny initiate/complete -> decide approved -> issue permit).
 * Shared by the permit-issued notification test and the enforcement tests
 * below, which all need a real active permit to act on.
 */
async function createAndIssuePermit(advertiserName: string, actor: string): Promise<{ applicationId: string; permitId: string }> {
  const applicationId = randomUUID();
  await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
    id: applicationId,
    advertiserName,
    advertiserOrg: `${advertiserName} Pvt Ltd`,
    advertisementType: "hoarding",
    location: { address: "MG Road, Kanpur" },
    dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 200 },
  }, actor));
  await q.drain();
  await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }, actor));
  await q.drain();

  const scrutinyId = randomUUID();
  await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, {
    id: scrutinyId, applicationId, scrutinyType: "zone_check", officerId: actor,
  }, actor));
  await q.drain();
  await q.publish(COMMANDS.completeScrutiny, makeMsg(COMMANDS.completeScrutiny, {
    id: scrutinyId, findings: { items: [{ checkItem: "zoning", result: "pass" }] },
  }, actor));
  await q.drain();
  await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId, decision: "approved" }, actor));
  await q.drain();

  const permitId = randomUUID();
  await q.publish(COMMANDS.issuePermit, makeMsg(COMMANDS.issuePermit, {
    id: permitId,
    applicationId,
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    location: { address: "MG Road, Kanpur" },
    advertisementType: "hoarding",
  }, actor));
  await q.drain();

  // Drain the outbox this setup accumulated (fee challan + submitted +
  // permit-issued notifications) so each test's own assertions only see the
  // delivery/challan row(s) produced by the action under test.
  await relayAll(advDb, q, "advertisement-service");
  await q.drain();

  return { applicationId, permitId };
}

describe("advertisement-service cross-service wiring — submitApplication -> finance.challan.create -> finance.gl.post (real DB, no mocks)", () => {
  it("raises a real finance challan + GL journal for the application's licence fee, back-linked to the advertisement application", async () => {
    const actor = randomUUID();
    const applicationId = randomUUID();
    const feeMinor = calculateFeeMinor({ advertisementType: "digital", dimensions: { widthFt: 15, heightFt: 10, areaInSqFt: 150 } });
    expect(feeMinor).toBeGreaterThan(0n);

    await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
      id: applicationId,
      advertiserName: "Sunrise Digital Signage Co",
      advertiserOrg: "Sunrise Digital Pvt Ltd",
      advertisementType: "digital",
      location: { address: "Civil Lines, Kanpur" },
      dimensions: { widthFt: 15, heightFt: 10, areaInSqFt: 150 },
    }, actor));
    await q.drain();

    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }, actor));
    await q.drain();

    // Hop 1: advertisement-service's own outbox -> shared queue (finance.challan.create, notification.send).
    const relayedFromAdv = await relayAll(advDb, q, "advertisement-service");
    expect(relayedFromAdv).toBeGreaterThanOrEqual(1);
    await q.drain();

    // Hop 2: finance-service's own outbox (challanCreate enqueued finance.gl.post) -> shared queue.
    const relayedFromFinance = await relayAll(financeDb, q, "finance-service");
    expect(relayedFromFinance).toBeGreaterThanOrEqual(1);
    await q.drain();

    const [seededHead] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeHeads)
        .where(and(eq(financeHeads.tenantId, TENANT), eq(financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE))).limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    // sourceRef is the application's human-facing applicationNumber (mirrors
    // shop-service's cross-events-integration.test.ts), not the raw UUID —
    // look it up from advertisement-service's own row rather than assuming.
    const [appRow] = await runWithTenant(TENANT, () =>
      advDb.transaction((tx) => tx.select().from(advApplications).where(eq(advApplications.id, applicationId)).limit(1)),
    );
    expect(appRow, "advertisement application row must exist").toBeTruthy();

    const [challanRow] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeChallans).where(eq(financeChallans.sourceRef, appRow!.applicationNumber)).limit(1),
    );
    expect(challanRow, "advertisement-service's submitApplication must have produced a real finance challan").toBeTruthy();
    expect(challanRow.sourceService).toBe("advertisement");
    expect(challanRow.sourceRef).toBe(appRow!.applicationNumber);
    expect(challanRow.depositor).toBe("Sunrise Digital Signage Co");
    // The exact value asserted here matters less than that it survived the
    // whole hop as a bigint — never coerced through a JS number anywhere in
    // this module's wiring (applications/consumer.ts passes
    // application.feeMinor, a Drizzle bigint-mode column, straight into
    // emitMunicipalFeeChallan).
    expect(challanRow.amountMinor).toBe(feeMinor);
    expect(challanRow.receiptHeadId).toBe(seededHead.id);

    const journalId = deterministicId(`challan:${challanRow.id}`);
    const [journalRow] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeJournals).where(eq(financeJournals.id, journalId)).limit(1),
    );
    expect(journalRow, "GL journal must have been posted by the second hop (finance.gl.post)").toBeTruthy();
    const creditLine = journalRow.lines.find((l: { creditMinor: string }) => l.creditMinor !== "0");
    const debitLine = journalRow.lines.find((l: { debitMinor: string }) => l.debitMinor !== "0");
    expect(BigInt(creditLine.creditMinor)).toBe(feeMinor);
    expect(BigInt(debitLine.debitMinor)).toBe(feeMinor);
    expect(creditLine.accountCode).toBe(seededHead.id);
  });

  it("also emits a municipal.application.submitted notification, delivered with the resolved (non-default) template", async () => {
    const actor = randomUUID();
    const applicationId = randomUUID();
    await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
      id: applicationId,
      advertiserName: "Ganga Outdoor Media",
      advertiserOrg: "Ganga Outdoor Media Pvt Ltd",
      advertisementType: "banner",
      location: { address: "Mall Road, Kanpur" },
      dimensions: { widthFt: 10, heightFt: 5, areaInSqFt: 50 },
    }, actor));
    await q.drain();
    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }, actor));
    await q.drain();
    await relayAll(advDb, q, "advertisement-service");
    await q.drain();

    // Own fresh actor per test (see makeMsg's header note): findByRecipient
    // can only see rows keyed to THIS test's actor, so no ordering/timing
    // assumption about other tests' deliveries is needed.
    const deliveries = await findByRecipient(TENANT, actor, 50);
    const delivery = deliveries.find((d) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted);
    expect(delivery, "the notification.send consumer must have written a delivery row for this citizen").toBeTruthy();
    expect(delivery!.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    expect(delivery!.recipient).toBe("Ganga Outdoor Media");
  });
});

describe("advertisement-service cross-service wiring — issuePermit -> notification.send (permit-issued template, real DB)", () => {
  it("issuing a permit notifies the advertiser with the municipal.permit.issued template, not the generic default", async () => {
    const actor = randomUUID();
    const { applicationId } = await createAndIssuePermit("Kanpur Hoarding Traders", actor);

    const deliveries = await findByRecipient(TENANT, actor, 100);
    const delivery = deliveries.find((d) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalPermitIssued);
    expect(delivery, "issuePermit must have emitted a municipal.permit.issued notification").toBeTruthy();
    expect(delivery!.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    expect(delivery!.recipient).toBe("Kanpur Hoarding Traders");
    void applicationId;
  });
});

describe("advertisement-service cross-service wiring — imposePenalty -> finance.challan.create + notification.send (real DB)", () => {
  it("imposing a penalty on a violation linked to a permit raises a real finance challan and notifies the permit holder", async () => {
    const actor = randomUUID();
    const { permitId } = await createAndIssuePermit("Kanpur Penalty Test Traders", actor);

    const violationId = randomUUID();
    await q.publish(COMMANDS.reportViolation, makeMsg(COMMANDS.reportViolation, {
      id: violationId,
      permitId,
      violationType: "oversized",
      description: "Structure exceeds the permitted dimensions",
      location: { address: "MG Road, Kanpur" },
    }, actor));
    await q.drain();

    const before = await findByRecipient(TENANT, actor, 200);

    await q.publish(COMMANDS.imposePenalty, makeMsg(COMMANDS.imposePenalty, { violationId, penaltyMinor: "750000" }, actor));
    await q.drain();

    const relayed = await relayAll(advDb, q, "advertisement-service");
    expect(relayed, "imposePenalty must have unpublished finance.challan.create + notification.send rows to relay").toBeGreaterThanOrEqual(2);
    await q.drain();
    await relayAll(financeDb, q, "finance-service");
    await q.drain();

    // ── real finance challan, back-linked to the violation, correct amount ──
    const [challanRow] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeChallans).where(eq(financeChallans.sourceRef, violationId)).limit(1),
    );
    expect(challanRow, "imposePenalty must have produced a real finance challan for the penalty").toBeTruthy();
    expect(challanRow.sourceService).toBe("advertisement");
    expect(challanRow.depositor).toBe("Kanpur Penalty Test Traders");
    expect(challanRow.amountMinor).toBe(750000n);

    // ── real notification, resolved to municipal.fee.due, not the default ──
    const after = await findByRecipient(TENANT, actor, 200);
    expect(after.length, "imposePenalty must have written a NEW delivery row").toBe(before.length + 1);
    const delivery = after[0]!;
    expect(delivery.templateId).toBe(SYSTEM_TEMPLATE_IDS.municipalFeeDue);
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    expect(delivery.recipient).toBe("Kanpur Penalty Test Traders");
  });
});
