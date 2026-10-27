/**
 * GAP-BILLING-SUBSCRIPTIONS-03 (review r1): GET /v1/billing/subscriptions/history lists the
 * caller's own tenant subscriptions (active and past), newest first, with plan name and price.
 * Tenant-scoped, role-gated. Real Postgres, real Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const PLATFORM = "00000000-0000-0000-0000-000000000000";
const T = randomUUID();
const OTHER = randomUUID();
const NO_SUB = randomUUID();
const ACTOR = randomUUID();
const PLAN = randomUUID();
const bearer = (tid: string, roles: string[] = ["tenant_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-subhist" }, SECRET, 3600)}`,
});
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`
    INSERT INTO plans.billing_plans (id, tenant_id, name, code, price_minor, currency, created_by, updated_by)
    VALUES (${PLAN}, ${PLATFORM}, 'History Standard', ${"hist-" + PLAN.slice(0, 8)}, 499900, 'INR', ${ACTOR}, ${ACTOR})`));
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(billingSubscriptions).values([
    { tenantId: T, planId: PLAN, status: "cancelled", startedAt: new Date("2025-04-01T05:00:00Z"), endsAt: new Date("2026-03-31T05:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR },
    { tenantId: T, planId: PLAN, status: "active", startedAt: new Date("2026-04-01T05:00:00Z"), endsAt: new Date("2027-03-31T05:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR },
  ])));
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(billingSubscriptions).values({
    tenantId: OTHER, planId: PLAN, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  app = await buildApp();
});
afterAll(async () => {
  for (const t of [T, OTHER]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, t))));
  }
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plans WHERE id = ${PLAN}`));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/billing/subscriptions/history", () => {
  it("lists the tenant's active and past subscriptions newest first with plan name and price", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history", headers: bearer(T) });
    expect(r.statusCode).toBe(200);
    const { data } = r.json() as { data: Array<Record<string, unknown>> };
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ status: "active", planName: "History Standard", startDate: "2026-04-01", renewalDate: "2027-03-31", amountMinor: "499900", currency: "INR", plan: PLAN });
    expect(data[1]).toMatchObject({ status: "cancelled", startDate: "2025-04-01", renewalDate: "2026-03-31" });
  });

  it("the summary endpoint still reports the CURRENT subscription, not the newest past one", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(T) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "active", startDate: "2026-04-01" });
  });

  it("a second current subscription for the same tenant is refused by the DB, a past one is not", async () => {
    await expect(runWithTenant(T, () => db.transaction((tx) => tx.insert(billingSubscriptions).values({
      tenantId: T, planId: PLAN, status: "trial", createdBy: ACTOR, updatedBy: ACTOR,
    })))).rejects.toThrow();
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(billingSubscriptions).values({
      tenantId: T, planId: PLAN, status: "cancelled", startedAt: new Date("2024-04-01T05:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history", headers: bearer(T) });
    expect((r.json() as { data: unknown[] }).data).toHaveLength(3);
  });

  it("never returns another tenant's subscriptions", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history", headers: bearer(OTHER) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it("a tenant with no subscriptions gets an empty list (not an error)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history", headers: bearer(NO_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: [] });
  });

  it("is role-gated: a role outside the readers list gets 403, no token gets 401", async () => {
    const denied = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history", headers: bearer(T, ["employee"]) });
    expect(denied.statusCode).toBe(403);
    const anon = await app.inject({ method: "GET", url: "/v1/billing/subscriptions/history" });
    expect(anon.statusCode).toBe(401);
  });
});
