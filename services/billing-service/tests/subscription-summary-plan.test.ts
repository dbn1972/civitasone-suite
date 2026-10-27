/**
 * GAP-BILLING-SUBSCRIPTIONS-03 (UAT B4): GET /v1/billing/subscriptions carries the plan name,
 * subscription start, renewal (scheduled end) and plan price (paise string) so the page can show
 * what the tenant is on and what it costs. Unknown stays null. Real Postgres, real Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PLATFORM = "00000000-0000-0000-0000-000000000000";
const T = randomUUID();
const NO_SUB = randomUUID();
const ACTOR = randomUUID();
const PLAN = randomUUID();
const bearer = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["tenant_admin"], sid: "s-sub3" }, SECRET, 3600)}` });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`
    INSERT INTO plans.billing_plans (id, tenant_id, name, code, price_minor, currency, created_by, updated_by)
    VALUES (${PLAN}, ${PLATFORM}, 'Sub3 Standard', ${"sub3-" + PLAN.slice(0, 8)}, 499900, 'INR', ${ACTOR}, ${ACTOR})`));
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(billingSubscriptions).values({
    tenantId: T, planId: PLAN, status: "active", startedAt: new Date("2026-04-01T05:00:00Z"), endsAt: new Date("2027-03-31T05:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR,
  })));
  app = await buildApp();
});
afterAll(async () => {
  await runWithTenant(T, () => db.transaction((tx) => tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, T))));
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plans WHERE id = ${PLAN}`));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/billing/subscriptions plan fields", () => {
  it("returns the plan name, start date, renewal date and the plan price in paise", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(T) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ planName: "Sub3 Standard", startDate: "2026-04-01", renewalDate: "2027-03-31", amountMinor: "499900", currency: "INR", status: "active" });
  });
  it("a tenant with no subscription still gets a null body", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/billing/subscriptions", headers: bearer(NO_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("null");
  });
});
