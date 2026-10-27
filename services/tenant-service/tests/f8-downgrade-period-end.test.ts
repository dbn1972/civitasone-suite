/**
 * OWNER DECISION F8 (2026-10-27): an approved plan downgrade takes effect at the END
 * of the current billing period. Approval only SCHEDULES the change; a sweeper
 * applies it once the period has ended. Real Postgres, real consumers, real routes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { plans } from "../src/modules/plans/schema.js";
import { quotas } from "../src/modules/quotas/schema.js";
import { subscriptions, downgradeRequests } from "../src/modules/subscriptions/schema.js";
import { registerSubscriptionConsumers } from "../src/modules/subscriptions/consumer.js";
import { sweepDueDowngrades } from "../src/modules/subscriptions/sweeper.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const T = randomUUID();
const PLATFORM = randomUUID();
const REQUESTER = randomUUID();
const BILLING = randomUUID();
const BIG = randomUUID(); const SMALL = randomUUID(); const MID = randomUUID(); const SUB = randomUUID();
const PERIOD_END = new Date(Date.now() + 20 * 86400_000);
const tok = (tid: string, sub: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s1" }, SECRET);
const REASON = "Headcount drops below 50 after the restructuring";

async function call(m: string, u: string, tid: string, sub: string, roles: string[], payload?: unknown) {
  const app = await buildApp();
  const r = await app.inject({ method: m as "GET", url: u, headers: { authorization: `Bearer ${tok(tid, sub, roles)}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  return { status: r.statusCode, json: () => (r.body ? JSON.parse(r.body) : undefined) };
}
const request = () => call("POST", "/v1/tenant/subscription/downgrade", T, REQUESTER, ["tenant_admin"], { targetPlanId: SMALL, acknowledgement: true, reason: REASON });
const approve = (id: string) => call("POST", `/v1/tenant/subscription/downgrade-requests/${id}/decision`, PLATFORM, BILLING, ["platform_admin"], { tenantId: T, decision: "approve" });

const rows = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(downgradeRequests).where(eq(downgradeRequests.tenantId, T))));
const sub = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, SUB)))))[0]!;
const outbox = async () => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))))).map((m) => ({ topic: m.topic, payload: m.payload as Record<string, unknown> }));
const makeDue = () => runWithTenant(T, () => db.transaction((tx) => tx.update(downgradeRequests).set({ effectiveAt: new Date(Date.now() - 60_000) }).where(eq(downgradeRequests.tenantId, T))));

async function wipe() {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(downgradeRequests).where(eq(downgradeRequests.tenantId, T));
    await tx.delete(subscriptions).where(eq(subscriptions.tenantId, T));
    await tx.delete(quotas).where(eq(quotas.tenantId, T));
    await tx.delete(plans).where(eq(plans.tenantId, T));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
  }));
}
const plan = (id: string, code: string, price: bigint, maxUsers: number, maxStorageGb: number) => ({
  id, tenantId: T, code, name: code, edition: "psu" as const, maxUsers, maxStorageGb, priceMinor: price, createdBy: REQUESTER, updatedBy: REQUESTER,
});
async function scheduled() {
  expect((await request()).status).toBe(202); await infraQueue.drain();
  const [row] = await rows();
  expect((await approve(row!.id)).status).toBe(202); await infraQueue.drain();
  return row!.id;
}

describe("approved downgrade applies at period end (F8)", () => {
  beforeAll(async () => { await wipe(); registerSubscriptionConsumers(infraQueue); await infraQueue.start(); });
  beforeEach(async () => {
    await wipe();
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.insert(plans).values([plan(BIG, "BIG", 9_999_900n, 1000, 500), plan(SMALL, "SMALL", 999_900n, 50, 50), plan(MID, "MID", 4_999_900n, 200, 100)]);
      await tx.insert(subscriptions).values({ id: SUB, tenantId: T, planId: BIG, status: "active", startDate: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: PERIOD_END, createdBy: REQUESTER, updatedBy: REQUESTER });
      await tx.insert(quotas).values([
        { tenantId: T, resource: "users", limit: 1000, used: 20, createdBy: REQUESTER, updatedBy: REQUESTER },
        { tenantId: T, resource: "storage_gb", limit: 500, used: 10, createdBy: REQUESTER, updatedBy: REQUESTER },
      ]);
    }));
  });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("approval SCHEDULES the downgrade for the period end: the plan does not change yet and no 'downgraded' event is emitted", async () => {
    const id = await scheduled();
    const [row] = await rows();
    expect(row).toMatchObject({ id, status: "approved", decidedBy: BILLING, appliedAt: null });
    expect(row!.effectiveAt?.getTime()).toBe(PERIOD_END.getTime());
    expect((await sub()).planId).toBe(BIG);
    const out = await outbox();
    expect(out.some((e) => e.topic === "tenant.subscription.downgraded")).toBe(false);
    expect(out.some((e) => e.payload.action === "downgrade_approve" && e.payload.resourceId === id && typeof e.payload.effectiveAt === "string")).toBe(true);
  });

  it("the sweeper does nothing before the period has ended", async () => {
    await scheduled();
    expect(await sweepDueDowngrades(infraQueue)).toBe(0);
    await infraQueue.drain();
    expect((await sub()).planId).toBe(BIG);
    expect((await rows())[0]!.appliedAt).toBeNull();
  });

  it("once the period has ended the sweeper applies it exactly once: plan moves, outcome recorded, event + audit emitted", async () => {
    const id = await scheduled();
    await makeDue();
    expect(await sweepDueDowngrades(infraQueue)).toBe(1);
    await infraQueue.drain();
    expect((await sub()).planId).toBe(SMALL);
    expect((await rows())[0]).toMatchObject({ status: "approved", applyOutcome: "applied" });
    expect((await rows())[0]!.appliedAt).not.toBeNull();
    const out = await outbox();
    expect(out.filter((e) => e.topic === "tenant.subscription.downgraded")).toHaveLength(1);
    expect(out.some((e) => e.payload.action === "downgrade_apply" && e.payload.resourceId === id)).toBe(true);
    // a second sweep finds nothing left to apply
    expect(await sweepDueDowngrades(infraQueue)).toBe(0);
    await infraQueue.drain();
    expect((await outbox()).filter((e) => e.topic === "tenant.subscription.downgraded")).toHaveLength(1);
  });

  it("if the subscription moved to another plan after approval, nothing is overwritten and the outcome says so", async () => {
    await scheduled();
    await runWithTenant(T, () => db.transaction((tx) => tx.update(subscriptions).set({ planId: MID }).where(eq(subscriptions.id, SUB))));
    await makeDue();
    await sweepDueDowngrades(infraQueue); await infraQueue.drain();
    expect((await sub()).planId).toBe(MID);
    expect((await rows())[0]).toMatchObject({ applyOutcome: "skipped_plan_changed" });
    expect((await outbox()).some((e) => e.topic === "tenant.subscription.downgraded")).toBe(false);
  });

  it("a new downgrade request is refused while an approved one is still scheduled", async () => {
    await scheduled();
    const again = await request();
    expect(again.status).toBe(409);
    expect(again.json().code).toBe("DOWNGRADE_ALREADY_SCHEDULED");
  });

  it("the cross-tenant due-list function reports nothing for a not-yet-due request", async () => {
    await scheduled();
    const res = await db.execute(sql`SELECT count(*)::int AS n FROM subscriptions.list_due_downgrades(10)`);
    const raw = (Array.isArray(res) ? res : (res as unknown as { rows: unknown[] }).rows) as Array<{ n: number }>;
    expect(raw[0]!.n).toBe(0);
  });
});
