/**
 * grant-service test suite
 *
 * 1. Aadhaar masking — raw never stored, only last4 + token
 * 2. Eligibility rejection — age 60 vs max_age 45
 * 3. UC expenditure > disbursed — consumer emits event, no DB write
 * 4. CQRS disbursement — installment → consumer → DB
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { grantBeneficiaries, grantAadhaarLinks } from "../src/modules/beneficiary/schema.js";
import { grantEligibilityCriteria } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantUcStatements } from "../src/modules/utilisation/schema.js";
import { maskAadhaar } from "../src/modules/beneficiary/domain.js";
import { checkEligibility } from "../src/modules/scheme/domain.js";
import { assertUcExpenditureWithinDisbursed } from "../src/modules/utilisation/domain.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerBeneficiaryConsumers } from "../src/modules/beneficiary/consumer.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { registerUtilisationConsumers } from "../src/modules/utilisation/consumer.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { EVENTS, COMMANDS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000002";
const SCHEME = "22222222-bbbb-4000-8000-000000000001";
const BEN    = "33333333-cccc-4000-8000-000000000001";
const APP    = "44444444-dddd-4000-8000-000000000001";
const INST   = "55555555-eeee-4000-8000-000000000001";
const DISB   = "66666666-ffff-4000-8000-000000000001";
const UC     = "77777777-aaaa-4000-8000-000000000001";
const MSG_BEN  = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const MSG_AAD  = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const MSG_UC   = "aaaaaaaa-bbbb-4ccc-8ddd-000000000003";
const MSG_INST = "aaaaaaaa-bbbb-4ccc-8ddd-000000000004";
const MSG_DISB = "aaaaaaaa-bbbb-4ccc-8ddd-000000000005";

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(grantUcStatements).where(eq(grantUcStatements.tenantId, TENANT));
  await db.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
  await db.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
  await db.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
  await db.delete(grantEligibilityCriteria).where(eq(grantEligibilityCriteria.tenantId, TENANT));
  await db.delete(grantAadhaarLinks).where(eq(grantAadhaarLinks.tenantId, TENANT));
  await db.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
  const msgIds = [MSG_BEN, MSG_AAD, MSG_UC, MSG_INST, MSG_DISB];
  for (const id of msgIds) {
    await db.delete(processed).where(eq(processed.messageId, id));
  }
}

describe("Beneficiary domain — Aadhaar masking (DPDP §4)", () => {
  it("input 123456789012 → last4=9012, token only, raw never in DB", async () => {
    const { last4, token } = maskAadhaar("123456789012");
    expect(last4).toBe("9012");
    expect(token).toHaveLength(64);
    expect(token).not.toContain("123456789012");

    const q = new MemoryQueue();
    registerBeneficiaryConsumers(q);
    await q.start();
    await wipe();

    await q.publish(COMMANDS.beneficiaryCreate, {
      messageId: MSG_BEN, type: COMMANDS.beneficiaryCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ben",
      schemaVersion: "1.0",
      payload: { id: BEN, tenantId: TENANT, name: "Test Ben", type: "individual", incomeAnnualMinor: 0 },
    });
    await new Promise((r) => setTimeout(r, 400));

    await q.publish(COMMANDS.beneficiarySeedAadhaar, {
      messageId: MSG_AAD, type: COMMANDS.beneficiarySeedAadhaar,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-aad",
      schemaVersion: "1.0",
      payload: { id: "88888888-bbbb-4000-8000-000000000001", tenantId: TENANT, beneficiaryId: BEN, aadhaar: "123456789012" },
    });
    await new Promise((r) => setTimeout(r, 400));

    const links = await db.select().from(grantAadhaarLinks).where(eq(grantAadhaarLinks.beneficiaryId, BEN));
    expect(links).toHaveLength(1);
    expect(links[0]!.aadhaarLast4).toBe("9012");
    expect(links[0]!.aadhaarToken).toBe(token);
    const allText = JSON.stringify(links[0]);
    expect(allText).not.toContain("123456789012");

    await q.stop();
  });
});

describe("Scheme domain — eligibility (pure)", () => {
  it("age 60 vs max_age 45 → not eligible", () => {
    const result = checkEligibility(
      [{ id: "c1", tenantId: TENANT, schemeId: SCHEME, criterionKey: "age", minValue: null, maxValue: "45", allowedValues: null, description: null, createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR, version: 1 }],
      { age: 60 },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("exceeds maximum");
  });
});

describe("Utilisation domain — UC expenditure (pure)", () => {
  it("expenditure > disbursed throws UC_EXPENDITURE_EXCEEDS_DISBURSED", () => {
    expect(() => assertUcExpenditureWithinDisbursed(100000n, 150000n))
      .toThrowError("UC_EXPENDITURE_EXCEEDS_DISBURSED");
  });
});

describe("Utilisation consumer — expenditure exceeds disbursed (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("UC with zero disbursed → uc.expenditure_exceeds in outbox, no UC row", async () => {
    const q = new MemoryQueue();
    registerUtilisationConsumers(q);
    await q.start();

    await q.publish(COMMANDS.ucSubmit, {
      messageId: MSG_UC, type: COMMANDS.ucSubmit,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-uc",
      schemaVersion: "1.0",
      payload: { id: UC, tenantId: TENANT, applicationId: APP, period: "2025-26", releasedMinor: 100000, utilisedMinor: 50000 },
    });
    await new Promise((r) => setTimeout(r, 600));

    const ucs = await db.select().from(grantUcStatements).where(eq(grantUcStatements.applicationId, APP));
    expect(ucs).toHaveLength(0);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const exceeded = outbox.find((o) => o.eventType === EVENTS.ucExpenditureExceeds);
    expect(exceeded).toBeDefined();

    await q.stop();
  });
});

describe("Disbursement consumer — CQRS wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("approved app + installment → disburse → DB row + outbox", async () => {
    const q = new MemoryQueue();
    registerSchemeConsumers(q);
    registerApplicationConsumers(q);
    registerDisbursementConsumers(q);
    await q.start();

    // Seed approved application directly
    await db.insert(grantApplications).values({
      id: APP, tenantId: TENANT, grantNo: "G-001", schemeId: SCHEME,
      beneficiaryId: BEN, purpose: "test", amountRequestedMinor: 500000n,
      amountApprovedMinor: 500000n, currency: "INR", status: "approved",
      approvedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    });

    await q.publish(COMMANDS.installmentCreate, {
      messageId: MSG_INST, type: COMMANDS.installmentCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-inst",
      schemaVersion: "1.0",
      payload: {
        applicationId: APP, tenantId: TENANT, currency: "INR",
        installments: [{ id: INST, installmentNo: 1, amountMinor: 300000 }],
      },
    });
    await new Promise((r) => setTimeout(r, 500));

    await q.publish(COMMANDS.disbursementInitiate, {
      messageId: MSG_DISB, type: COMMANDS.disbursementInitiate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-disb",
      schemaVersion: "1.0",
      payload: { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS" },
    });
    await new Promise((r) => setTimeout(r, 600));

    const disbs = await db.select().from(grantDisbursements).where(eq(grantDisbursements.id, DISB));
    expect(disbs).toHaveLength(1);
    expect(disbs[0]!.status).toBe("initiated");
    expect(disbs[0]!.pfmsTxnId).toContain("PFMS-");

    await q.stop();
  });
});

afterAll(async () => { await sqlClient.end(); });
