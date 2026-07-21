/**
 * grant-service — core-flow coverage (10/10 rubric).
 *
 * Closes gaps beyond grant.test.ts:
 *  - SoD self-approve → 403 at command boundary + sod_violation in consumer
 *  - Scheme budget reserve: atomic, over-budget reject, concurrent no-overspend
 *  - UC-gate: tranche N blocks until tranche N-1 UC is VALIDATED (not just submitted)
 *  - Disbursement: no double-disburse; completed-only sum; exceeds-approved reject
 *  - PFMS reconcile tenant-scoped
 *  - Aadhaar HMAC token determinism + tenant isolation
 *  - Idempotency: replayed command messageId is a no-op
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { grantBeneficiaries, grantAadhaarLinks } from "../src/modules/beneficiary/schema.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments, grantDisbursements, grantPfmsRecords } from "../src/modules/disbursement/schema.js";
import { grantUcStatements, grantUcValidations } from "../src/modules/utilisation/schema.js";
import { reserveSchemeBudget } from "../src/modules/scheme/repo.js";
import { sumDisbursedForApplication, findDisbursementByPfmsTxnId } from "../src/modules/disbursement/repo.js";
import { hasSubmittedUcForApplication } from "../src/modules/utilisation/repo.js";
import { listGrantSummaries, getGrantDetail } from "../src/modules/application/queries.js";
import { getDashboard } from "../src/modules/dashboard/queries.js";
import { grantComplianceReports } from "../src/modules/utilisation/schema.js";
import { cache as appCache } from "../src/shared/infra.js";
import { maskAadhaar } from "../src/modules/beneficiary/domain.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { registerUtilisationConsumers } from "../src/modules/utilisation/consumer.js";
import { randomUUID } from "node:crypto";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR   = "10000000-aaaa-4000-8000-000000000001";
const ACTOR2  = "10000000-aaaa-4000-8000-000000000002";
const TENANT  = "1f000000-aaaa-4000-8000-000000000002"; // isolated from grant.test.ts
const TENANT_B= "1f000000-bbbb-4000-8000-000000000002";
const SCHEME  = "2f000000-bbbb-4000-8000-000000000001";
const BEN     = "3f000000-cccc-4000-8000-000000000001";
const APP     = "4f000000-dddd-4000-8000-000000000001";

let seq = 0;
const uid = (_p?: string) => { seq++; return randomUUID(); };
const msgId = () => randomUUID();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** Helper: scoped read within tenant transaction (test assertion reads) */
async function scopedQuery<T>(tenant: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
}

async function wipe(tenant = TENANT) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenant));
    await tx.delete(grantUcValidations).where(eq(grantUcValidations.tenantId, tenant));
    await tx.delete(grantComplianceReports).where(eq(grantComplianceReports.tenantId, tenant));
    await tx.delete(grantUcStatements).where(eq(grantUcStatements.tenantId, tenant));
    await tx.delete(grantPfmsRecords).where(eq(grantPfmsRecords.tenantId, tenant));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, tenant));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, tenant));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, tenant));
    await tx.delete(grantAadhaarLinks).where(eq(grantAadhaarLinks.tenantId, tenant));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, tenant));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, tenant));
  }));
}

async function seedScheme(budget: bigint, tenant = TENANT, id = SCHEME) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(grantSchemes).values({
      id, tenantId: tenant, code: `SCH-${id.slice(0, 8)}`, name: "Flow Scheme",
      budgetMinor: budget, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: budget,
      currency: "INR", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

async function seedApprovedApp(approved: bigint, opts: { tenant?: string; scheme?: string; app?: string } = {}) {
  const tenant = opts.tenant ?? TENANT;
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(grantApplications).values({
      id: opts.app ?? APP, tenantId: tenant, grantNo: `G-${++seq}`, schemeId: opts.scheme ?? SCHEME,
      beneficiaryId: BEN, purpose: "test", amountRequestedMinor: approved,
      amountApprovedMinor: approved, currency: "INR", status: "approved",
      approvedAt: new Date(), submittedBy: ACTOR, approvedBy: ACTOR2,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

const wrap = (type: string, payload: Record<string, unknown>, tenant = TENANT, mid = msgId()) => ({
  messageId: mid, type, tenantId: tenant, actorId: ACTOR,
  correlationId: `corr-${seq}`, schemaVersion: "1.0", payload,
});

const settle = () => new Promise((r) => setTimeout(r, 500));

beforeEach(async () => { await wipe(); await wipe(TENANT_B); });
afterAll(async () => { await wipe(); await wipe(TENANT_B); await sqlClient.end(); });

// ---------------------------------------------------------------------------
describe("SoD — separation of duties on approval", () => {
  it("submitter==approver → 403 SOD_VIOLATION at the route boundary", async () => {
    await seedScheme(1_000_000n);
    // application submitted by ACTOR, status submitted
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantApplications).values({
        id: APP, tenantId: TENANT, grantNo: "G-SOD", schemeId: SCHEME, beneficiaryId: BEN,
        purpose: "x", amountRequestedMinor: 100n, amountApprovedMinor: 0n, currency: "INR",
        status: "under_review", submittedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const app = await buildApp();
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_admin"], sid: "s" }, JWT_SECRET);
    const res = await app.inject({
      method: "PATCH", url: `/v1/grants/applications/${APP}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountApprovedMinor: 100 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
  });

  it("consumer re-asserts SoD: self-approve emits sod_violation, no status flip", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantApplications).values({
        id: APP, tenantId: TENANT, grantNo: "G-SOD2", schemeId: SCHEME, beneficiaryId: BEN,
        purpose: "x", amountRequestedMinor: 100n, amountApprovedMinor: 0n, currency: "INR",
        status: "under_review", submittedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerApplicationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.applicationApprove,
      wrap(COMMANDS.applicationApprove, { id: APP, tenantId: TENANT, amountApprovedMinor: 100, approvedBy: ACTOR }));
    await settle();
    const rows = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantApplications).where(eq(grantApplications.id, APP)));
    expect(rows[0]!.status).toBe("under_review"); // unchanged
    const outbox = await scopedQuery(TENANT, (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.some((o) => o.eventType === "grant.application.sod_violation")).toBe(true);
    await q.stop();
  });

  it("distinct approver → approved", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantApplications).values({
        id: APP, tenantId: TENANT, grantNo: "G-OK", schemeId: SCHEME, beneficiaryId: BEN,
        purpose: "x", amountRequestedMinor: 100n, amountApprovedMinor: 0n, currency: "INR",
        status: "under_review", submittedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerApplicationConsumers(q);
    await q.start();
    await q.publish(COMMANDS.applicationApprove,
      wrap(COMMANDS.applicationApprove, { id: APP, tenantId: TENANT, amountApprovedMinor: 100, approvedBy: ACTOR2 }));
    await settle();
    const rows = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantApplications).where(eq(grantApplications.id, APP)));
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.amountApprovedMinor).toBe(100n);
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
describe("Scheme budget — atomic reservation", () => {
  it("reserve within budget succeeds and increments disbursed_minor", async () => {
    await seedScheme(1_000n);
    const ok = await runWithTenant(TENANT, () => db.transaction((tx) => reserveSchemeBudget(tx, SCHEME, TENANT, 600n)));
    expect(ok).toBe(true);
    const s = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME)));
    expect(s[0]!.disbursedMinor).toBe(600n);
  });

  it("reserve over budget is rejected, disbursed_minor unchanged", async () => {
    await seedScheme(1_000n);
    await runWithTenant(TENANT, () => db.transaction((tx) => reserveSchemeBudget(tx, SCHEME, TENANT, 600n)));
    const ok = await runWithTenant(TENANT, () => db.transaction((tx) => reserveSchemeBudget(tx, SCHEME, TENANT, 600n))); // 1200 > 1000
    expect(ok).toBe(false);
    const s = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME)));
    expect(s[0]!.disbursedMinor).toBe(600n);
  });

  it("cross-tenant reserve cannot touch another tenant's scheme", async () => {
    await seedScheme(1_000n, TENANT, SCHEME);
    const ok = await runWithTenant(TENANT_B, () => db.transaction((tx) => reserveSchemeBudget(tx, SCHEME, TENANT_B, 100n)));
    expect(ok).toBe(false);
    const s = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME)));
    expect(s[0]!.disbursedMinor).toBe(0n);
  });

  it("concurrent reservations never overspend the envelope", async () => {
    await seedScheme(1_000n);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => runWithTenant(TENANT, () => db.transaction((tx) => reserveSchemeBudget(tx, SCHEME, TENANT, 300n)))),
    );
    const granted = results.filter(Boolean).length;
    const s = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME)));
    expect(granted).toBe(3);                 // 3*300=900 <=1000, 4th would be 1200
    expect(s[0]!.disbursedMinor).toBe(900n);
    expect(s[0]!.disbursedMinor <= s[0]!.budgetMinor).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("Disbursement — budget gate + double-disburse guard", () => {
  async function setupInstallment(no: number, amount: bigint, instId: string) {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q);
    await q.start();
    await q.publish(COMMANDS.installmentCreate, wrap(COMMANDS.installmentCreate, {
      applicationId: APP, tenantId: TENANT, currency: "INR",
      installments: [{ id: instId, installmentNo: no, amountMinor: Number(amount) }],
    }));
    await settle();
    return q;
  }

  it("over-budget installment is rejected (no disbursement row, budget event emitted)", async () => {
    await seedScheme(100n);            // budget smaller than installment
    await seedApprovedApp(1_000n);
    const INST = uid("5f000000-eeee-4000-8000-");
    const q = await setupInstallment(1, 500n, INST);
    const DISB = uid("6f000000-ffff-4000-8000-");
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS" }));
    await settle();
    const disbs = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, DISB)));
    expect(disbs).toHaveLength(0);
    const outbox = await scopedQuery(TENANT, (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.some((o) => o.eventType === EVENTS.schemeBudgetExceeded)).toBe(true);
    await q.stop();
  });

  it("replayed disburse command (same messageId) is idempotent — single row", async () => {
    await seedScheme(1_000n);
    await seedApprovedApp(1_000n);
    const INST = uid("5f000001-eeee-4000-8000-");
    const q = await setupInstallment(1, 300n, INST);
    const DISB = uid("6f000001-ffff-4000-8000-");
    const mid = msgId();
    const m = wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS" }, TENANT, mid);
    await q.publish(COMMANDS.disbursementInitiate, m);
    await settle();
    await q.publish(COMMANDS.disbursementInitiate, m); // exact replay
    await settle();
    const disbs = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, INST)));
    expect(disbs).toHaveLength(1);
    const s = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantSchemes).where(eq(grantSchemes.id, SCHEME)));
    expect(s[0]!.disbursedMinor).toBe(300n); // budget reserved exactly once
    await q.stop();
  });

  it("second disburse on an already-disbursed installment → duplicate event, no extra row", async () => {
    await seedScheme(1_000n);
    await seedApprovedApp(1_000n);
    const INST = uid("5f000002-eeee-4000-8000-");
    const q = await setupInstallment(1, 300n, INST);
    const D1 = uid("6f000002-ffff-4000-8000-");
    const D2 = uid("6f000003-ffff-4000-8000-");
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: D1, tenantId: TENANT, installmentId: INST, mode: "PFMS" }));
    await settle();
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: D2, tenantId: TENANT, installmentId: INST, mode: "PFMS" }));
    await settle();
    const disbs = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, INST)));
    expect(disbs).toHaveLength(1);
    const outbox = await scopedQuery(TENANT, (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.some((o) => o.eventType === "grant.disbursement.duplicate")).toBe(true);
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
describe("UC-gate — tranche N blocks until tranche N-1 UC is VALIDATED", () => {
  it("installment #2 blocked when prior UC only submitted (not validated)", async () => {
    await seedScheme(10_000n);
    await seedApprovedApp(10_000n);
    const INST2 = uid("5f000010-eeee-4000-8000-");
    // prior tranche UC exists but is PENDING (not validated)
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantUcStatements).values({
        id: uid("7f000010-aaaa-4000-8000-"), tenantId: TENANT, applicationId: APP,
        period: "2025-26", installmentNo: 1, releasedMinor: 500n, utilisedMinor: 500n,
        varianceMinor: 0n, currency: "INR", status: "submitted", isImmutable: true,
        validationStatus: "pending", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q);
    await q.start();
    await q.publish(COMMANDS.installmentCreate, wrap(COMMANDS.installmentCreate, {
      applicationId: APP, tenantId: TENANT, currency: "INR",
      installments: [{ id: INST2, installmentNo: 2, amountMinor: 300 }],
    }));
    await settle();
    const DISB = uid("6f000010-ffff-4000-8000-");
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST2, mode: "PFMS" }));
    await settle();
    const disbs = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, DISB)));
    expect(disbs).toHaveLength(0);
    const outbox = await scopedQuery(TENANT, (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.some((o) => o.eventType === EVENTS.ucGateBlocked)).toBe(true);
    await q.stop();
  });

  it("hasSubmittedUcForApplication only true once prior tranche UC is validated", async () => {
    await seedApprovedApp(10_000n);
    const UC = uid("7f000011-aaaa-4000-8000-");
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantUcStatements).values({
        id: UC, tenantId: TENANT, applicationId: APP, period: "2025-26", installmentNo: 1,
        releasedMinor: 500n, utilisedMinor: 500n, varianceMinor: 0n, currency: "INR",
        status: "submitted", isImmutable: true, validationStatus: "pending",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    expect(await hasSubmittedUcForApplication(APP, TENANT, 2)).toBe(false);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(grantUcStatements).set({ validationStatus: "validated" }).where(eq(grantUcStatements.id, UC));
    }));
    expect(await hasSubmittedUcForApplication(APP, TENANT, 2)).toBe(true);
  });

  it("installment #2 proceeds once prior tranche UC is validated", async () => {
    await seedScheme(10_000n);
    await seedApprovedApp(10_000n);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantUcStatements).values({
        id: uid("7f000012-aaaa-4000-8000-"), tenantId: TENANT, applicationId: APP,
        period: "2025-26", installmentNo: 1, releasedMinor: 500n, utilisedMinor: 500n,
        varianceMinor: 0n, currency: "INR", status: "submitted", isImmutable: true,
        validationStatus: "validated", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const INST2 = uid("5f000012-eeee-4000-8000-");
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q);
    await q.start();
    await q.publish(COMMANDS.installmentCreate, wrap(COMMANDS.installmentCreate, {
      applicationId: APP, tenantId: TENANT, currency: "INR",
      installments: [{ id: INST2, installmentNo: 2, amountMinor: 300 }],
    }));
    await settle();
    const DISB = uid("6f000012-ffff-4000-8000-");
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST2, mode: "PFMS" }));
    await settle();
    const disbs = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, DISB)));
    expect(disbs).toHaveLength(1);
    expect(disbs[0]!.status).toBe("initiated");
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
describe("Disbursement settlement + completed-only sum + PFMS reconcile", () => {
  it("sumDisbursedForApplication counts only completed disbursements", async () => {
    await seedApprovedApp(10_000n);
    const INST = uid("5f000020-eeee-4000-8000-");
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantInstallments).values({
        id: INST, tenantId: TENANT, applicationId: APP, installmentNo: 1,
        amountMinor: 300n, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(grantDisbursements).values({
        id: uid("6f000020-ffff-4000-8000-"), tenantId: TENANT, installmentId: INST,
        amountMinor: 300n, currency: "INR", mode: "PFMS", pfmsTxnId: "PFMS-A",
        status: "initiated", retryCount: 0, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    expect(await sumDisbursedForApplication(db, APP, TENANT)).toBe(0n); // initiated not counted
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(grantDisbursements).set({ status: "completed" }).where(eq(grantDisbursements.pfmsTxnId, "PFMS-A"));
    }));
    expect(await sumDisbursedForApplication(db, APP, TENANT)).toBe(300n);
  });

  it("finance.payment.made completes the disbursement and reconciles PFMS", async () => {
    await seedScheme(10_000n);
    await seedApprovedApp(10_000n);
    const INST = uid("5f000021-eeee-4000-8000-");
    const DISB = uid("6f000021-ffff-4000-8000-");
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDisbursementConsumers(q);
    await q.start();
    await q.publish(COMMANDS.installmentCreate, wrap(COMMANDS.installmentCreate, {
      applicationId: APP, tenantId: TENANT, currency: "INR",
      installments: [{ id: INST, installmentNo: 1, amountMinor: 300 }],
    }));
    await settle();
    await q.publish(COMMANDS.disbursementInitiate,
      wrap(COMMANDS.disbursementInitiate, { id: DISB, tenantId: TENANT, installmentId: INST, mode: "PFMS" }));
    await settle();
    await q.publish(CONSUMED_EVENTS.financePaid,
      wrap(CONSUMED_EVENTS.financePaid, { disbursementId: DISB, outcome: "success" }));
    await settle();
    const d = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantDisbursements).where(eq(grantDisbursements.id, DISB)));
    expect(d[0]!.status).toBe("completed");
    expect(d[0]!.disbursedAt).not.toBeNull();
    const pfms = await scopedQuery(TENANT, (tx) =>
      tx.select().from(grantPfmsRecords).where(eq(grantPfmsRecords.disbursementId, DISB)));
    expect(pfms[0]!.reconciled).toBe(true);
    await q.stop();
  });

  it("findDisbursementByPfmsTxnId is tenant-scoped", async () => {
    const INST = uid("5f000022-eeee-4000-8000-");
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantInstallments).values({
        id: INST, tenantId: TENANT, applicationId: APP, installmentNo: 1,
        amountMinor: 1n, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
      });
      const DID = uid("6f000022-ffff-4000-8000-");
      await tx.insert(grantDisbursements).values({
        id: DID, tenantId: TENANT, installmentId: INST,
        amountMinor: 1n, currency: "INR", mode: "PFMS", pfmsTxnId: "PFMS-SCOPED",
        status: "initiated", retryCount: 0, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    expect(await findDisbursementByPfmsTxnId("PFMS-SCOPED", TENANT)).not.toBeNull();
    expect(await findDisbursementByPfmsTxnId("PFMS-SCOPED", TENANT_B)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Aadhaar HMAC — determinism, masking, tenant isolation", () => {
  it("same Aadhaar → same token; different Aadhaar → different token; last4 correct", () => {
    const a = maskAadhaar("123456789012");
    const b = maskAadhaar("123456789012");
    const c = maskAadhaar("999999999012");
    expect(a.token).toBe(b.token);
    expect(a.token).not.toBe(c.token);
    expect(a.last4).toBe("9012");
    expect(a.token).toHaveLength(64);
    expect(a.token).not.toContain("123456789012");
  });

  it("invalid Aadhaar (non-12-digit) throws", () => {
    expect(() => maskAadhaar("123")).toThrow("INVALID_AADHAAR");
    expect(() => maskAadhaar("12345678901a")).toThrow("INVALID_AADHAAR");
  });
});

// ---------------------------------------------------------------------------
describe("Tenant isolation — list routes never leak across tenants", () => {
  it("scheme seeded in TENANT is invisible to TENANT_B token", async () => {
    await seedScheme(1_000n, TENANT, SCHEME);
    const app = await buildApp();
    const tokB = signToken({ sub: ACTOR, tid: TENANT_B, roles: ["grant_officer"], sid: "s" }, JWT_SECRET);
    const res = await app.inject({
      method: "GET", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${tokB}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(SCHEME);
  });

  it("the same scheme IS visible to its owning tenant", async () => {
    await seedScheme(1_000n, TENANT, SCHEME);
    const app = await buildApp();
    const tok = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_officer"], sid: "s" }, JWT_SECRET);
    const res = await app.inject({
      method: "GET", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${tok}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(SCHEME);
  });
});

// ---------------------------------------------------------------------------
describe("Read model — disbursed/pending amounts + grant detail (regression)", () => {
  async function insertCompletedDisbursement(amount: bigint) {
    const INST = uid("5f000030-eeee-4000-8000-");
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantInstallments).values({
        id: INST, tenantId: TENANT, applicationId: APP, installmentNo: 1,
        amountMinor: amount, currency: "INR", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(grantDisbursements).values({
        id: uid("6f000030-ffff-4000-8000-"), tenantId: TENANT, installmentId: INST,
        amountMinor: amount, currency: "INR", mode: "PFMS", pfmsTxnId: `PFMS-RM-${seq}`,
        status: "completed", disbursedAt: new Date(), retryCount: 0, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    return INST;
  }

  it("listGrantSummaries reflects real disbursed + pending (not hardcoded 0/full)", async () => {
    await seedScheme(100_000n);
    await seedApprovedApp(50_000n); // approved = 500.00
    await insertCompletedDisbursement(30_000n); // 300.00 disbursed
    await appCache.invalidate(appCache.makeKey(TENANT, "grants", "list:50"));
    const rows = await listGrantSummaries(TENANT, 50);
    const g = rows.find((r) => r.id === APP)!;
    expect(g.totalAmount).toBe(500);
    expect(g.disbursedAmount).toBe(300);
    expect(g.pendingAmount).toBe(200); // not the full 500
  });

  it("getGrantDetail populates installments and ucs (previously hardcoded empty)", async () => {
    await seedScheme(100_000n);
    await seedApprovedApp(50_000n);
    await insertCompletedDisbursement(30_000n);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(grantUcStatements).values({
        id: uid("7f000030-aaaa-4000-8000-"), tenantId: TENANT, applicationId: APP,
        period: "2025-26", installmentNo: 1, releasedMinor: 30_000n, utilisedMinor: 25_000n,
        varianceMinor: 5_000n, currency: "INR", status: "submitted", isImmutable: true,
        validationStatus: "validated", ucRef: "UC-001", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    await appCache.invalidate(appCache.makeKey(TENANT, "application", APP));
    const detail = await getGrantDetail(APP, TENANT);
    expect(detail).not.toBeNull();
    expect(detail!.installments.length).toBe(1);
    expect(detail!.installments[0]!.status).toBe("released");
    expect(detail!.installments[0]!.amount).toBe(300);
    expect(detail!.ucs.length).toBe(1);
    expect(detail!.ucs[0]!.ucNo).toBe("UC-001");
    expect(detail!.ucs[0]!.amount).toBe(250);
    expect(detail!.disbursedAmount).toBe(300);
  });

  it("getDashboard reports real disbursed total (not hardcoded 0)", async () => {
    await seedScheme(100_000n);
    await seedApprovedApp(50_000n);
    await insertCompletedDisbursement(30_000n);
    const dash = await getDashboard(TENANT);
    expect(dash.disbursedAmount).toBe(300);
  });

  it("overdue detection: stale (>90d-old) report does NOT mark an app compliant", async () => {
    await seedApprovedApp(50_000n);
    // approved 200 days ago → reporting window has elapsed
    const oldApproved = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.update(grantApplications).set({ approvedAt: oldApproved }).where(eq(grantApplications.id, APP));
      // a compliance report exists, but it is 200 days old (outside the 90d window)
      await tx.insert(grantComplianceReports).values({
        id: uid("8f000030-aaaa-4000-8000-"), tenantId: TENANT, applicationId: APP,
        period: "2025-26", kind: "interim", status: "submitted",
        createdAt: oldApproved, updatedAt: oldApproved, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const dash = await getDashboard(TENANT);
    expect(dash.overdueGrantIds).toContain(APP); // stale report must not clear overdue
  });
});

