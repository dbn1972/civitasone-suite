/**
 * M6 (module-sale gap): plans and prices linked to modules. Real Postgres (own throwaway DB, DATABASE_URL).
 *
 *  - plan -> catalogue modules: an explicit set is closed over hard dependencies; a plan that predates migration 0035
 *    (catalogue_modules NULL) resolves from its product ids exactly as before (existing plans unchanged);
 *  - price store: effective-dated, append-only, INR minor units, GST separate on a quote; the consumer closes the
 *    previous open price and writes the audit event in the same transaction; replays are no-ops;
 *  - access: price writes are platform-admin only; reads need a tenant-admin/config role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { plans, planPrices } from "../src/modules/plans/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPlanConsumers } from "../src/modules/plans/consumer.js";
import { createPlanBody, updatePlanBody, setPriceBody } from "../src/modules/plans/validators.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a6000001-6666-4000-8000-000000000001";
const ACTOR = "a6000002-6666-4000-8000-000000000002";
const PLAN_NEW = randomUUID();
// fresh message ids every run: _inbox.processed outlives the suite and would turn a re-run into replays
const [MSG1, MSG2, MSG3] = [randomUUID(), randomUUID(), randomUUID()];
const PLAN_LEGACY = randomUUID();
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "m6" }, SECRET, 3600)}` });
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as typeof db)));

function planRow(id: string, code: string, extra: Partial<typeof plans.$inferInsert>) {
  return { id, tenantId: TENANT, code, name: code, edition: "govt_dept" as const, maxUsers: 100, maxStorageGb: 10, enabledModules: [] as string[], priceMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR, ...extra };
}

async function wipe() {
  await scoped(async (tx) => {
    await tx.delete(planPrices).where(eq(planPrices.tenantId, TENANT));
    await tx.delete(plans).where(eq(plans.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  });
}

async function deliver(queue: MemoryQueue, messageId: string, payload: Record<string, unknown>) {
  await queue.publish(COMMANDS.planPriceSet, { messageId, type: COMMANDS.planPriceSet, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload: { id: messageId, ...payload } });
  await new Promise<void>((r) => setTimeout(r, 400));
}

describe("M6 plan modules + price store (real DB)", () => {
  let queue: MemoryQueue;
  beforeAll(async () => {
    await wipe();
    queue = new MemoryQueue();
    registerPlanConsumers(queue);
    await queue.start();
    await scoped(async (tx) => {
      // a plan with an explicit catalogue set: Payroll only (its hard dependency Employee is pulled in)
      await tx.insert(plans).values(planRow(PLAN_NEW, "hr_payroll", { catalogueModules: ["payroll"], enabledModules: ["payroll"] }));
      // a plan exactly as it exists today: product ids only, catalogue_modules NULL
      await tx.insert(plans).values(planRow(PLAN_LEGACY, "legacy_hrms", { enabledModules: ["hrms", "finance"] }));
    });
  });
  afterAll(async () => {
    await queue.stop();
    await wipe();
    await sqlClient.end();
  });

  it("resolves a plan's catalogue modules with hard dependencies", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_NEW}/modules`, headers: bearer(["tenant_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ planCode: "hr_payroll", source: "catalogue_modules", selected: ["payroll"], pulledIn: ["employee"], moduleIds: ["employee", "payroll"] });
  });

  it("a plan that predates catalogue_modules resolves from its product ids as before (existing plans unchanged)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_LEGACY}/modules`, headers: bearer(["tenant_admin"]) });
    await app.close();
    const body = res.json();
    expect(body.source).toBe("enabled_modules");
    expect(body.moduleIds).toEqual(expect.arrayContaining(["employee", "recruitment", "appraisal", "finance", "budget", "treasury"]));
    const row = await scoped((tx) => tx.select().from(plans).where(eq(plans.id, PLAN_LEGACY)));
    expect(row[0]?.catalogueModules).toBeNull();
  });

  it("validators accept a real catalogue set and refuse an unknown or non-sellable module", () => {
    const base = { code: "x1", name: "X plan", edition: "psu", maxUsers: 5, maxStorageGb: 5, priceMinor: 0 };
    expect(createPlanBody.safeParse({ ...base, catalogueModules: ["employee", "leave"] }).success).toBe(true);
    expect(createPlanBody.parse(base).catalogueModules).toBeNull();
    expect(createPlanBody.safeParse({ ...base, catalogueModules: ["nonsense"] }).success).toBe(false);
    expect(updatePlanBody.safeParse({ catalogueModules: ["nonsense"] }).success).toBe(false);
    expect(updatePlanBody.safeParse({ catalogueModules: null }).success).toBe(true);
    expect(setPriceBody.safeParse({ subjectKind: "addon", subjectKey: "identity", amountMinor: 1, effectiveFrom: "2026-04-01" }).success).toBe(false); // core
    expect(setPriceBody.safeParse({ subjectKind: "addon", subjectKey: "recruitment", amountMinor: 1, effectiveFrom: "2026-04-01" }).success).toBe(true);
  });

  it("records effective-dated prices: closes the previous open price, audits, and replays are no-ops", async () => {
    await deliver(queue, MSG1, { subjectKind: "plan", subjectKey: "hr_payroll", billingCycle: "annual", amountMinor: 1_000_000, gstRateBps: 1800, effectiveFrom: "2026-04-01" });
    await deliver(queue, MSG2, { subjectKind: "plan", subjectKey: "hr_payroll", billingCycle: "annual", amountMinor: 1_200_000, gstRateBps: 1800, effectiveFrom: "2026-10-01" });
    // replay of the second delivery through a fresh queue (bypasses queue-level dedup): stopped by _inbox.processed
    const q2 = new MemoryQueue();
    registerPlanConsumers(q2);
    await q2.start();
    await deliver(q2, MSG2, { subjectKind: "plan", subjectKey: "hr_payroll", billingCycle: "annual", amountMinor: 9_999_999, gstRateBps: 1800, effectiveFrom: "2026-10-01" });
    await q2.stop();

    const rows = await scoped((tx) => tx.select().from(planPrices).where(and(eq(planPrices.tenantId, TENANT), eq(planPrices.subjectKey, "hr_payroll"))));
    const sorted = rows.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(sorted.map((r) => [r.effectiveFrom, r.effectiveTo, r.amountMinor, r.currency])).toEqual([
      ["2026-04-01", "2026-09-30", 1_000_000n, "INR"],
      ["2026-10-01", null, 1_200_000n, "INR"],
    ]);
    const audit = await scoped((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, "audit.event.record"))));
    const priced = audit.filter((r) => (r.payload as { action?: string }).action === "plan_price_set");
    expect(priced).toHaveLength(2);
    expect(priced.map((r) => (r.payload as { actorId?: string }).actorId ?? r.actorId)).toContain(ACTOR);
    const second = priced.find((r) => (r.payload as { effectiveFrom?: string }).effectiveFrom === "2026-10-01")!;
    expect(second.payload).toMatchObject({ closedPreviousTo: "2026-09-30", amountMinor: "1200000", subjectKey: "hr_payroll" });
    expect((await db.select().from(processed).where(eq(processed.messageId, MSG2)))).toHaveLength(1);
  });

  it("add-on prices: quote shows plan + add-on with GST separate; an add-on already in the plan is refused", async () => {
    await deliver(queue, MSG3, { subjectKind: "addon", subjectKey: "recruitment", billingCycle: "annual", amountMinor: 250_050, gstRateBps: 1800, effectiveFrom: "2026-04-01" });
    const app = await buildApp();
    const ok = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_NEW}/quote?addons=recruitment&date=2026-11-11`, headers: bearer(["tenant_admin"]) });
    expect(ok.statusCode).toBe(200);
    const q = ok.json();
    expect(q).toMatchObject({ currency: "INR", unit: "paise", onDate: "2026-11-11" });
    expect(q.lines).toEqual([
      expect.objectContaining({ kind: "plan", key: "hr_payroll", netMinor: "1200000", gstMinor: "216000", grossMinor: "1416000" }),
      expect.objectContaining({ kind: "addon", key: "recruitment", netMinor: "250050", gstMinor: "45009", grossMinor: "295059" }),
    ]);
    expect(q.totals).toEqual({ netMinor: "1450050", gstMinor: "261009", grossMinor: "1711059" });
    // before the first price starts: 404
    const early = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_NEW}/quote?date=2026-03-31`, headers: bearer(["tenant_admin"]) });
    expect(early.statusCode).toBe(404);
    // the historical price still applies to a historical date
    const hist = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_NEW}/quote?date=2026-06-01`, headers: bearer(["tenant_admin"]) });
    expect(hist.json().totals.netMinor).toBe("1000000");
    // payroll is part of the plan: it cannot be bought again
    const dup = await app.inject({ method: "GET", url: `/v1/plans/${PLAN_NEW}/quote?addons=payroll&date=2026-11-11`, headers: bearer(["tenant_admin"]) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("ADDON_ALREADY_IN_PLAN");
    await app.close();
  });

  it("price writes: platform admin only, back-dated price refused with 409, unknown plan 404, valid write 202", async () => {
    const app = await buildApp();
    const body = { subjectKind: "plan", subjectKey: "hr_payroll", amountMinor: 1_500_000, effectiveFrom: "2027-04-01" };
    const asTenantAdmin = await app.inject({ method: "POST", url: "/v1/plans/prices", headers: bearer(["tenant_admin"]), payload: body });
    expect(asTenantAdmin.statusCode).toBe(403);
    const asEmployee = await app.inject({ method: "GET", url: "/v1/plans/prices", headers: bearer(["employee"]) });
    expect(asEmployee.statusCode).toBe(403);
    const backdated = await app.inject({ method: "POST", url: "/v1/plans/prices", headers: bearer(["platform_admin"]), payload: { ...body, effectiveFrom: "2026-10-01" } });
    expect(backdated.statusCode).toBe(409);
    expect(backdated.json().code).toBe("PRICE_BACKDATED");
    const ghost = await app.inject({ method: "POST", url: "/v1/plans/prices", headers: bearer(["platform_admin"]), payload: { ...body, subjectKey: "no_such_plan" } });
    expect(ghost.statusCode).toBe(404);
    const ok = await app.inject({ method: "POST", url: "/v1/plans/prices", headers: bearer(["platform_admin"]), payload: body });
    expect(ok.statusCode).toBe(202);
    const list = await app.inject({ method: "GET", url: "/v1/plans/prices?kind=plan&key=hr_payroll", headers: bearer(["tenant_admin"]) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ currency: "INR", unit: "paise", gst: "separate" });
    expect(list.json().prices).toHaveLength(2);
    await app.close();
  });
});
