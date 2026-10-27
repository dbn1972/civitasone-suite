/**
 * GAP-GRANTS-INSTALLMENTS-03 (UAT B4):
 *  - GET /v1/grants/installments returns the GrantInstallmentSummary wire shape the
 *    web read-model expects (it used to leak raw DB rows), including grantStatus
 *    and the payee's masked account, so the UI can refuse a release on a suspended
 *    grant and show where the money goes;
 *  - the disbursement consumer, which is the authority, rejects an out-of-sequence
 *    release (#2 while #1 is still pending) and a release on a withdrawn grant, each
 *    with a grant.disbursement.rejected event and an audit record, and books nothing.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries, grantBankAccounts } from "../src/modules/beneficiary/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerDisbursementConsumers } from "../src/modules/disbursement/consumer.js";
import { effectiveGrantStatus } from "../src/modules/disbursement/domain.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();

const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
async function send(q: Queue, topic: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await scoped((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId)));
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`message on ${topic} was never processed`);
}

async function seedGrant(opts: { appStatus?: string; schemeStatus?: string; installments?: number } = {}) {
  const schemeId = randomUUID(), benId = randomUUID(), appId = randomUUID();
  const ids = Array.from({ length: opts.installments ?? 3 }, () => randomUUID());
  await scoped(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: schemeId, tenantId: TENANT, code: `B4I-${schemeId.slice(0, 8)}`, name: "B4 Scheme",
      budgetMinor: 10_000_000n, disbursedMinor: 0n, minAmountMinor: 0n, maxAmountMinor: 10_000_000n,
      status: opts.schemeStatus ?? "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantBeneficiaries).values({
      id: benId, tenantId: TENANT, name: "Nashik Mahila Mandal", type: "society",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantBankAccounts).values({
      tenantId: TENANT, beneficiaryId: benId, accountNoMasked: "XXXXXXXX4321", bankIfsc: "SBIN0001234",
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantApplications).values({
      id: appId, tenantId: TENANT, grantNo: `G-B4-${appId.slice(0, 6)}`, schemeId, beneficiaryId: benId,
      purpose: "B4 grant", amountRequestedMinor: 9_000_000n, amountApprovedMinor: 9_000_000n,
      status: opts.appStatus ?? "approved", approvedAt: new Date(), submittedBy: randomUUID(), approvedBy: randomUUID(),
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    for (const [i, id] of ids.entries()) {
      await tx.insert(grantInstallments).values({
        id, tenantId: TENANT, applicationId: appId, installmentNo: i + 1, amountMinor: 1_000_000n,
        status: "pending", dueDate: "2026-11-01", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  });
  return { schemeId, benId, appId, ids };
}

const events = async (type: string) =>
  (await scoped((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))))
    .filter((r) => r.eventType === type);

async function getList(qs = "") {
  const app = await buildApp();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_officer"], sid: "s-b4i" }, SECRET, 3600);
  const res = await app.inject({ method: "GET", url: `/v1/grants/installments${qs}`, headers: { authorization: `Bearer ${token}` } });
  await app.close();
  return res;
}

afterAll(async () => {
  await scoped(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBankAccounts).where(eq(grantBankAccounts.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  });
  await sqlClient.end();
});

describe("effectiveGrantStatus (pure)", () => {
  it("maps application and scheme state to the release-eligibility status", () => {
    expect(effectiveGrantStatus("approved", "active")).toBe("active");
    expect(effectiveGrantStatus("approved", "suspended")).toBe("suspended");
    expect(effectiveGrantStatus("approved", "closed")).toBe("suspended");
    expect(effectiveGrantStatus("withdrawn", "active")).toBe("cancelled");
    expect(effectiveGrantStatus("rejected", "active")).toBe("cancelled");
    expect(effectiveGrantStatus("completed", "active")).toBe("completed");
    expect(effectiveGrantStatus("approved", null)).toBe("active");
  });
});

describe("GET /v1/grants/installments wire shape", () => {
  it("returns summaries with grantStatus and the masked payee account", async () => {
    const { appId, ids } = await seedGrant({ schemeStatus: "suspended" });
    const res = await getList(`?appId=${appId}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.installmentNo)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      id: ids[0], grantId: appId, granteeName: "Nashik Mahila Mandal", amount: 1_000_000,
      scheduledDate: "2026-11-01", status: "pending", grantStatus: "suspended",
      payeeAccountLast4: "4321", payeeIfsc: "SBIN0001234",
    });
    expect(String(rows[0]!.grantNo)).toMatch(/^G-B4-/);
    expect(rows[0]).not.toHaveProperty("accountNoMasked");
  });

  it("lists all tenant installments when no appId is given", async () => {
    await seedGrant({ installments: 1 });
    const res = await getList();
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => typeof r.grantNo === "string" && typeof r.grantStatus === "string")).toBe(true);
  });
});

describe("disbursement consumer fails closed (server is the authority)", () => {
  async function boot() { const q = wire(new MemoryQueue()); registerDisbursementConsumers(q); await q.start(); return q; }
  const disbRows = (instId: string) => scoped((tx) => tx.select().from(grantDisbursements).where(eq(grantDisbursements.installmentId, instId)));

  it("rejects releasing #2 while #1 is still pending", async () => {
    const { ids } = await seedGrant();
    const q = await boot();
    const before = (await events("grant.disbursement.rejected")).length;
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: ids[1], mode: "PFMS", reason: "second tranche" });
    await q.stop();
    expect(await disbRows(ids[1]!)).toHaveLength(0);
    const rejected = (await events("grant.disbursement.rejected")).slice(before);
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected[0]!.payload)).toContain("OUT_OF_SEQUENCE");
    const audits = (await events("audit.event.record")).filter((r) => JSON.stringify(r.payload).includes(ids[1]!));
    expect(audits.some((r) => JSON.stringify(r.payload).includes("failure"))).toBe(true);
  });

  it("rejects a release on a withdrawn grant", async () => {
    const { ids } = await seedGrant({ appStatus: "withdrawn", installments: 1 });
    const q = await boot();
    const before = (await events("grant.disbursement.rejected")).length;
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: ids[0], mode: "PFMS", reason: "first tranche" });
    await q.stop();
    expect(await disbRows(ids[0]!)).toHaveLength(0);
    const rejected = (await events("grant.disbursement.rejected")).slice(before);
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected[0]!.payload)).toContain("GRANT_NOT_ACTIVE");
  });

  it("still releases the lowest pending installment of an active grant", async () => {
    const { ids } = await seedGrant({ installments: 2 });
    const q = await boot();
    await send(q, COMMANDS.disbursementInitiate, { id: randomUUID(), tenantId: TENANT, installmentId: ids[0], mode: "PFMS", reason: "first tranche" });
    await q.stop();
    expect(await disbRows(ids[0]!)).toHaveLength(1);
  });
});
