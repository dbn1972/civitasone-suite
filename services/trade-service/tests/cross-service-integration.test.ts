/**
 * Cross-service integration test (real Postgres for trade-service,
 * finance-service AND notification-service — no mocks) for Wave 3's
 * cross-events wiring: services/trade-service/src/shared/cross-events.ts
 * (merged inert via PR #1002) is now actually called from
 * applications/consumer.ts, approvals/consumer.ts, licences/consumer.ts and
 * lifecycle/consumer.ts.
 *
 * This proves the full real path, not just the payload shape:
 *   trade-service command -> trade-service consumer (real DB write) ->
 *   trade-service outbox -> relay -> finance-service / notification-service
 *   consumer (real DB write) -> (finance only) second relay hop -> GL
 *   consumer (real DB write).
 *
 * Mirrors services/finance-service/tests/municipal-challan-integration.test.ts
 * and services/notification-service/tests/municipal-template-integration.test.ts
 * (both merged tonight via PR #1002) for the receiving-side assertions, but
 * drives the PRODUCING side for real instead of hand-publishing the
 * finance.challan.create / notification.send payload directly.
 *
 * finance-service and notification-service are loaded via dynamic import
 * with process.env.DATABASE_URL swapped to each service's own database
 * immediately before that import — each service's shared/db.ts binds its
 * Drizzle client from DATABASE_URL exactly once, at first import, so this is
 * how one vitest worker can host three services' DB singletons at once
 * without editing any of the three services' source. Restored to
 * trade-service's own DSN afterward for hygiene (trade's own db.ts already
 * bound correctly at this file's static-import time, before any of this runs).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { withTenantScope } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { MUNICIPAL_FEE_RECEIPT_HEAD_CODE, SYSTEM_TEMPLATE_IDS } from "@civitasone/events";

import { db as tradeDb, sqlClient as tradeSqlClient } from "../src/shared/db.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approvals/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { calculateFeeMinor } from "../src/modules/applications/domain.js";

const TENANT = "00000000-0000-0000-0000-000000000001"; // platform-default tenant — 0075 head already seeded (migration 0070)
const ACTOR = "cc000002-ec00-4000-8000-0000000000ff";
const BANK_CODE = "1100";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
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

const TRADE_DSN = "postgres://trade_svc:trade_dev_pw@localhost:5440/civitas_trade";
const FINANCE_DSN = "postgres://finance_svc:finance_dev_pw@localhost:5440/civitas_finance";
const NOTIFICATION_DSN = "postgres://notification_svc:notification_dev_pw@localhost:5440/civitas_notification";

let q: MemoryQueue;

beforeAll(async () => {
  // ── finance-service: bind its own db.ts singleton against civitas_finance,
  // then load its consumers/schema — all via relative cross-service imports
  // (same pattern already used by services/inventory-service/tests/
  // consolidation-proof.test.ts and services/revenue-service/tests/
  // e2e-revenue-flow.test.ts).
  process.env.DATABASE_URL = FINANCE_DSN;
  process.env.DB_URL = FINANCE_DSN;
  process.env.PII_ENC_KEY = "test_pii_enc_key_for_finance_32c";
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
  process.env.DATABASE_URL = NOTIFICATION_DSN;
  process.env.DB_URL = NOTIFICATION_DSN;
  process.env.NOTIFICATION_PII_KEY = "test_notification_pii_key_32chars";
  process.env.NOTIFICATION_PII_SALT = "civitas-notification-pii-test";
  process.env.NOTIFICATION_EMAIL_DRIVER = "stub";
  process.env.NOTIFICATION_IN_APP_DRIVER = "memory";
  process.env.NOTIFICATION_SMS_DRIVER = "stub";
  process.env.NOTIFICATION_WHATSAPP_DRIVER = "stub";
  const notificationDbMod = await import("../../notification-service/src/shared/db.js");
  notificationSqlClient = notificationDbMod.sqlClient;
  ({ registerDeliveryConsumers } = await import("../../notification-service/src/modules/deliveries/consumer.js"));
  ({ findByRecipient } = await import("../../notification-service/src/modules/deliveries/repo.js"));

  // Restore trade-service's own DSN (trade's db.ts already bound correctly
  // before this file's beforeAll ran — this is just hygiene for anything
  // that re-reads process.env.DATABASE_URL later in the same worker).
  process.env.DATABASE_URL = TRADE_DSN;
  process.env.DB_URL = TRADE_DSN;

  // Fixture: the BANK_CODE control head isn't seeded by any migration for
  // this tenant (same gap the finance reference test documents) — the
  // consumer resolves it by code exactly like it resolves the municipal fee
  // head (0075, which migration 0070 DID seed for this tenant).
  await withTenantScope(financeDb, TENANT, (tx: never) =>
    (tx as typeof financeDb).insert(financeHeads).values({
      id: randomUUID(), tenantId: TENANT, code: BANK_CODE, name: "Bank (trade cross-service test)",
      level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing(),
  );

  // One shared in-process queue carries all three services' commands/events.
  // trade-service's own register*Consumers already tenant-scope internally
  // (tenantScoped(rawQueue) inside each function); finance-service's and
  // notification-service's consumer.ts files don't self-wrap, so they're
  // registered through the SAME tenantScoped() Proxy trade-service exports —
  // it is a generic wrapper (packages/db's withTenantConsumer) with nothing
  // trade-specific in it.
  q = new MemoryQueue();
  registerApplicationConsumers(q);
  registerApprovalConsumers(q);
  registerLicenceConsumers(q);
  registerTreasuryConsumers(tenantScoped(q));
  registerGlConsumers(tenantScoped(q));
  registerDeliveryConsumers(tenantScoped(q));
  await q.start();
});

afterAll(async () => {
  await q.stop();
  await financeSqlClient.end({ timeout: 5 });
  await notificationSqlClient.end({ timeout: 5 });
  await tradeSqlClient.end({ timeout: 5 });
});

describe("trade-service cross-service wiring — submitApplication -> finance.challan.create -> finance.gl.post (real DB, no mocks)", () => {
  it("raises a real finance challan + GL journal for the application's licence fee, back-linked to the trade application", async () => {
    const applicationId = randomUUID();
    const feeMinor = calculateFeeMinor({ tradeCategory: "manufacturing", areaInSqft: 700, employeeCount: 15 });
    expect(feeMinor).toBeGreaterThan(0n);

    await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
      id: applicationId,
      businessName: "Sunrise Textiles Manufacturing",
      tradeCategory: "manufacturing",
      ownerName: "Asha Rao",
      premisesAddress: { line1: "12 Industrial Estate Rd", city: "Kanpur", pin: "208001" },
      areaInSqft: 700,
      employeeCount: 15,
    }));
    await q.drain();

    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }));
    await q.drain();

    // Hop 1: trade-service's own outbox -> shared queue (finance.challan.create, notification.send).
    const relayedFromTrade = await relayOnce(tradeDb as never, q, 100, "trade-service");
    expect(relayedFromTrade).toBeGreaterThanOrEqual(1);
    await q.drain();

    // Hop 2: finance-service's own outbox (challanCreate enqueued finance.gl.post) -> shared queue.
    const relayedFromFinance = await relayOnce(financeDb as never, q, 100, "finance-service");
    expect(relayedFromFinance).toBeGreaterThanOrEqual(1);
    await q.drain();

    const [seededHead] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeHeads)
        .where(and(eq(financeHeads.tenantId, TENANT), eq(financeHeads.code, MUNICIPAL_FEE_RECEIPT_HEAD_CODE))).limit(1),
    );
    expect(seededHead, "migration 0070 must have seeded the 0075 municipal-fee receipt head").toBeTruthy();

    const [challanRow] = await withTenantScope(financeDb, TENANT, (tx: never) =>
      (tx as typeof financeDb).select().from(financeChallans).where(eq(financeChallans.sourceRef, applicationId)).limit(1),
    );
    expect(challanRow, "trade-service's submitApplication must have produced a real finance challan").toBeTruthy();
    expect(challanRow.sourceService).toBe("trade");
    expect(challanRow.sourceRef).toBe(applicationId);
    expect(challanRow.depositor).toBe("Sunrise Textiles Manufacturing");
    // The exact value asserted here matters less than that it survived the
    // whole hop as a bigint — never coerced through a JS number anywhere in
    // this module's wiring (applications/consumer.ts passes application.feeMinor,
    // a Drizzle bigint-mode column, straight into emitMunicipalFeeChallan).
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
    const applicationId = randomUUID();
    await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
      id: applicationId,
      businessName: "Ganga Sweets & Snacks",
      tradeCategory: "food_beverage",
      ownerName: "Ramesh Gupta",
      premisesAddress: { line1: "4 Market Rd", city: "Kanpur", pin: "208001" },
    }));
    await q.drain();
    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }));
    await q.drain();
    await relayOnce(tradeDb as never, q, 100, "trade-service");
    await q.drain();

    const deliveries = await findByRecipient(TENANT, ACTOR, 50);
    const delivery = deliveries.find((d) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted);
    expect(delivery, "the notification.send consumer must have written a delivery row for this citizen").toBeTruthy();
    expect(delivery!.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    expect(delivery!.recipient).toBe("Ganga Sweets & Snacks");
  });
});

describe("trade-service cross-service wiring — issueLicence -> notification.send (permit-issued template, real DB)", () => {
  it("issuing a licence notifies the applicant with the municipal.permit.issued template, not the generic default", async () => {
    const applicationId = randomUUID();
    await q.publish(COMMANDS.createApplication, makeMsg(COMMANDS.createApplication, {
      id: applicationId,
      businessName: "Kanpur Hardware Traders",
      tradeCategory: "retail",
      ownerName: "Meena Verma",
      premisesAddress: { line1: "7 Civil Lines", city: "Kanpur", pin: "208001" },
    }));
    await q.drain();
    await q.publish(COMMANDS.submitApplication, makeMsg(COMMANDS.submitApplication, { id: applicationId }));
    await q.drain();

    const scrutinyId = randomUUID();
    await q.publish(COMMANDS.initiateScrutiny, makeMsg(COMMANDS.initiateScrutiny, {
      id: scrutinyId, applicationId, scrutinyType: "document_check", officerId: ACTOR,
    }));
    await q.drain();
    await q.publish(COMMANDS.completeScrutiny, makeMsg(COMMANDS.completeScrutiny, {
      id: scrutinyId, findings: { items: [{ checkItem: "documents", result: "pass" }] },
    }));
    await q.drain();
    await q.publish(COMMANDS.decideApplication, makeMsg(COMMANDS.decideApplication, { applicationId, decision: "approved" }));
    await q.drain();

    const licenceId = randomUUID();
    await q.publish(COMMANDS.issueLicence, makeMsg(COMMANDS.issueLicence, {
      id: licenceId, applicationId, tradeCategory: "retail", validityMonths: 12,
    }));
    await q.drain();

    // Relay trade-service's outbox — this batch carries BOTH the
    // submitApplication step's municipal.application.submitted notification
    // (retail's calculateFeeMinor is > 0, so a fee challan was queued too)
    // and this step's municipal.permit.issued notification; the assertion
    // below filters by templateId so it finds the right one regardless.
    await relayOnce(tradeDb as never, q, 100, "trade-service");
    await q.drain();

    const deliveries = await findByRecipient(TENANT, ACTOR, 50);
    const delivery = deliveries.find((d) => d.templateId === SYSTEM_TEMPLATE_IDS.municipalPermitIssued);
    expect(delivery, "issueLicence must have emitted a municipal.permit.issued notification").toBeTruthy();
    expect(delivery!.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);
    expect(delivery!.recipient).toBe("Kanpur Hardware Traders");
  });
});
