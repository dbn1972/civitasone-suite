/**
 * OWNER DECISION #24 (TENANT-ADMIN-PLANS-02): a downgrade is a REQUEST with a
 * required reason, blocked when usage exceeds the target plan's limits, and
 * approved by platform billing (never by the requester). Real Postgres, real
 * consumers, real routes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { plans } from "../src/modules/plans/schema.js";
import { quotas } from "../src/modules/quotas/schema.js";
import { subscriptions, downgradeRequests } from "../src/modules/subscriptions/schema.js";
import { registerSubscriptionConsumers } from "../src/modules/subscriptions/consumer.js";
import { exceededLimits, isDowngrade } from "../src/modules/subscriptions/downgrade.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-0000000024a1";
const OTHER = "aaaaaaaa-1111-4000-8000-0000000024a2";
const PLATFORM = "aaaaaaaa-1111-4000-8000-0000000024a0";
const REQUESTER = "cccccccc-3333-4000-8000-0000000024a1";
const BILLING = "cccccccc-3333-4000-8000-0000000024a2";
const BIG = randomUUID(); const SMALL = randomUUID(); const PRICIER = randomUUID(); const SUB = randomUUID();
const tok = (tid: string, sub: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s1" }, SECRET);
const REASON = "Headcount drops below 50 after the restructuring";

async function call(m: string, u: string, tid: string, sub: string, roles: string[], payload?: unknown) {
  const app = await buildApp();
  const r = await app.inject({ method: m as "GET", url: u, headers: { authorization: `Bearer ${tok(tid, sub, roles)}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  return { status: r.statusCode, json: () => (r.body ? JSON.parse(r.body) : undefined), body: r.body };
}
const request = (body: Record<string, unknown>) => call("POST", "/v1/tenant/subscription/downgrade", T, REQUESTER, ["tenant_admin"], body);
const good = { targetPlanId: SMALL, acknowledgement: true, reason: REASON };
const decide = (id: string, decision: string, extra: Record<string, unknown> = {}, who = BILLING, roles = ["platform_admin"], tenantId = T) =>
  call("POST", `/v1/tenant/subscription/downgrade-requests/${id}/decision`, PLATFORM, who, roles, { tenantId, decision, ...extra });

const rows = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(downgradeRequests).where(eq(downgradeRequests.tenantId, T))));
const sub = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, SUB)))))[0]!;
const setUsers = (used: number) => runWithTenant(T, () => db.transaction((tx) => tx.update(quotas).set({ used }).where(and(eq(quotas.tenantId, T), eq(quotas.resource, "users")))));
const events = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))))).map((m) => ({ topic: m.topic, payload: m.payload as Record<string, unknown> }));
const audits = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))))).map((m) => m.payload as Record<string, unknown>);

async function wipe() {
  for (const t of [T, OTHER]) await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(downgradeRequests).where(eq(downgradeRequests.tenantId, t));
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, t));
    await tx.delete(quotas).where(eq(quotas.tenantId, t));
    await tx.delete(plans).where(eq(plans.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }));
}
const plan = (id: string, code: string, price: bigint, maxUsers: number, maxStorageGb: number) => ({
  id, tenantId: T, code, name: code, edition: "psu" as const, maxUsers, maxStorageGb, priceMinor: price, createdBy: REQUESTER, updatedBy: REQUESTER,
});

describe("pure downgrade rules", () => {
  it("reports exactly the limits that usage exceeds", () => {
    expect(exceededLimits({ users: 10, storage_gb: 10 }, { maxUsers: 50, maxStorageGb: 50, priceMinor: 1n })).toEqual([]);
    expect(exceededLimits({ users: 80, storage_gb: 70 }, { maxUsers: 50, maxStorageGb: 50, priceMinor: 1n })).toEqual([
      { resource: "users", used: 80, limit: 50 }, { resource: "storage_gb", used: 70, limit: 50 },
    ]);
    expect(exceededLimits({ users: 50, storage_gb: 50 }, { maxUsers: 50, maxStorageGb: 50, priceMinor: 1n })).toEqual([]);
  });
  it("a downgrade must be strictly cheaper (bigint minor units)", () => {
    expect(isDowngrade({ priceMinor: 10_000_000_000_000_001n }, { priceMinor: 10_000_000_000_000_000n })).toBe(true);
    expect(isDowngrade({ priceMinor: 5n }, { priceMinor: 5n })).toBe(false);
  });
});

describe("downgrade request lifecycle (owner decision #24)", () => {
  beforeAll(async () => {
    await wipe();
    registerSubscriptionConsumers(infraQueue);
    await infraQueue.start();
  });
  beforeEach(async () => {
    await wipe();
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.insert(plans).values([plan(BIG, "BIG", 9_999_900n, 1000, 500), plan(SMALL, "SMALL", 999_900n, 50, 50), plan(PRICIER, "PRICIER", 99_999_900n, 5000, 5000)]);
      await tx.insert(subscriptions).values({ id: SUB, tenantId: T, planId: BIG, status: "active", startDate: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400_000), createdBy: REQUESTER, updatedBy: REQUESTER });
      await tx.insert(quotas).values([
        { tenantId: T, resource: "users", limit: 1000, used: 20, createdBy: REQUESTER, updatedBy: REQUESTER },
        { tenantId: T, resource: "storage_gb", limit: 500, used: 10, createdBy: REQUESTER, updatedBy: REQUESTER },
      ]);
    }));
  });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("a reason of at least 10 characters is required, and the acknowledgement", async () => {
    for (const body of [{ targetPlanId: SMALL, acknowledgement: true }, { ...good, reason: "short" }, { ...good, reason: "          " }, { ...good, acknowledgement: false }]) {
      expect((await request(body)).status).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("is BLOCKED (409, with the exceeded limits) when usage is above the target plan's limits; nothing is recorded", async () => {
    await setUsers(80);
    const r = await request(good);
    expect(r.status).toBe(409);
    expect(r.json().code).toBe("USAGE_EXCEEDS_TARGET_PLAN");
    expect(r.json().details).toEqual([{ resource: "users", used: 80, limit: 50 }]);
    expect(await rows()).toHaveLength(0);
  });

  it("rejects a non-downgrade and the same plan", async () => {
    expect((await request({ ...good, targetPlanId: PRICIER })).json().code).toBe("NOT_A_DOWNGRADE");
    expect((await request({ ...good, targetPlanId: BIG })).json().code).toBe("SAME_PLAN");
    expect((await request({ ...good, targetPlanId: randomUUID() })).json().code).toBe("PLAN_NOT_FOUND");
  });

  it("a valid request is only RECORDED as pending (not self-serve): the plan does not change, and it is audited with the reason", async () => {
    const r = await request(good);
    expect(r.status).toBe(202);
    expect(r.json()).toMatchObject({ status: "pending" });
    await infraQueue.drain();
    const [row] = await rows();
    expect(row).toMatchObject({ status: "pending", targetPlanId: SMALL, fromPlanId: BIG, requestedBy: REQUESTER, reason: REASON });
    expect(row!.usageSnapshot.checks).toEqual([{ resource: "users", used: 20, limit: 50 }, { resource: "storage_gb", used: 10, limit: 50 }]);
    expect((await sub()).planId).toBe(BIG);
    expect((await audits()).some((a) => a.action === "downgrade_request" && a.reason === REASON)).toBe(true);
    // the domain event platform billing is notified from names the request and the requester
    expect((await events()).find((e) => e.topic === "tenant.subscription.downgrade_requested")?.payload).toMatchObject({ requestId: row!.id, fromPlanId: BIG, targetPlanId: SMALL, requestedBy: REQUESTER });
    // a second request while one is open is refused
    expect((await request(good)).json().code).toBe("REQUEST_ALREADY_PENDING");
  });

  it("the tenant sees its own requests; platform billing sees the pending queue; others are refused", async () => {
    await request(good); await infraQueue.drain();
    const own = await call("GET", "/v1/tenant/subscription/downgrade-requests", T, REQUESTER, ["tenant_admin"]);
    expect(own.json().data).toHaveLength(1);
    expect((await call("GET", "/v1/tenant/subscription/downgrade-requests", OTHER, REQUESTER, ["tenant_admin"])).json().data).toHaveLength(0);
    const queueRows = await call("GET", "/v1/tenant/subscription/downgrade-requests/pending", PLATFORM, BILLING, ["platform_admin"]);
    expect(queueRows.status).toBe(200);
    expect(queueRows.json().data.some((d: { tenantId: string }) => d.tenantId === T)).toBe(true);
    expect((await call("GET", "/v1/tenant/subscription/downgrade-requests/pending", T, REQUESTER, ["tenant_admin"])).status).toBe(403);
  });

  it("only platform billing decides: tenant_admin cannot, and the requester cannot approve their own request (route)", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    expect((await decide(row!.id, "approve", {}, BILLING, ["tenant_admin"])).status).toBe(403);
    expect((await decide(row!.id, "approve", {}, REQUESTER, ["platform_admin"])).json().code).toBe("SELF_APPROVAL");
    expect((await sub()).planId).toBe(BIG);
  });

  it("the consumer re-enforces approver != requester (direct command) and the request stays pending", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    const mq = new MemoryQueue(); registerSubscriptionConsumers(mq);
    await mq.publish("tenant.subscription.downgrade_decision", { messageId: randomUUID(), type: "tenant.subscription.downgrade_decision", tenantId: T, actorId: REQUESTER, correlationId: "c", schemaVersion: "1.0", payload: { id: row!.id, decision: "approve", reason: null } }).catch(() => undefined);
    await mq.drain().catch(() => undefined);
    expect((await rows())[0]!.status).toBe("pending");
    expect((await sub()).planId).toBe(BIG);
  });

  it("a rejection needs a reason, leaves the plan alone and is audited; the tenant can then ask again", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    expect((await decide(row!.id, "reject")).status).toBe(400);
    expect((await decide(row!.id, "reject", { reason: "Contract runs to March" })).status).toBe(202);
    await infraQueue.drain();
    expect((await rows())[0]).toMatchObject({ status: "rejected", decidedBy: BILLING, decisionReason: "Contract runs to March" });
    expect((await sub()).planId).toBe(BIG);
    expect((await audits()).some((a) => a.action === "downgrade_reject")).toBe(true);
    // the requester (not the deciding billing officer) is the one notified, with the reason
    expect((await events()).find((e) => e.topic === "tenant.subscription.downgrade_rejected")?.payload).toMatchObject({ requestId: row!.id, requestedBy: REQUESTER, targetPlanId: SMALL, reason: "Contract runs to March" });
    expect((await request(good)).status).toBe(202);
  });

  it("platform billing approves: the change is SCHEDULED for the period end (F8), decided_by is recorded and an audit row is written", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    expect((await decide(row!.id, "approve")).status).toBe(202);
    await infraQueue.drain();
    expect((await rows())[0]).toMatchObject({ status: "approved", decidedBy: BILLING, appliedAt: null });
    // the plan moves only when the billing period ends (see f8-downgrade-period-end.test.ts)
    expect((await sub()).planId).toBe(BIG);
    expect((await audits()).some((a) => a.action === "downgrade_approve" && a.resourceId === row!.id)).toBe(true);
    // a decided request cannot be decided again
    expect((await decide(row!.id, "reject", { reason: "too late" })).json().code).toBe("ALREADY_DECIDED");
  });

  it("approval re-checks LIVE usage: if usage grew past the limit since the request, it is rejected, not applied", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    await setUsers(75);
    expect((await decide(row!.id, "approve")).status).toBe(202);
    await infraQueue.drain();
    expect((await rows())[0]).toMatchObject({ status: "rejected", decisionReason: "USAGE_EXCEEDS_TARGET_PLAN" });
    expect((await sub()).planId).toBe(BIG);
  });

  it("platform billing cannot decide a request through another tenant id (404)", async () => {
    await request(good); await infraQueue.drain();
    const [row] = await rows();
    expect((await decide(row!.id, "approve", {}, BILLING, ["platform_admin"], OTHER)).status).toBe(404);
  });
});
