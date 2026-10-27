/**
 * F9 (UAT B4): GET /v1/billing/tenant-plans is the edition-aware read behind the tenant-admin
 * Plans page: plans with limits, current plan, GST invoice rows and the tenant edition.
 * Real Postgres (FORCE RLS), real Fastify. tenant-service is stubbed at the fetch boundary.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { billingSubscriptions } from "../src/modules/subscriptions/schema.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PLATFORM = "00000000-0000-0000-0000-000000000000";
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const PLAN_FREE = randomUUID();
const PLAN_PRO = randomUUID();
const CODE = randomUUID().slice(0, 8);
const SUP = "07AAACF9101A1Z5";
const REC = "07AABCD5678B1Z2";
const bearer = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-f9" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(t: string, fn: (tx: Tx) => Promise<R>) => runWithTenant(t, () => db.transaction(fn)) as Promise<R>;

let app: Awaited<ReturnType<typeof buildApp>>;
const realFetch = globalThis.fetch;
let tenantEdition: string | "down" = "govt";
let seenAuth: string | undefined;

beforeAll(async () => {
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`
    INSERT INTO plans.billing_plans (id, tenant_id, name, code, price_minor, currency, created_by, updated_by) VALUES
      (${PLAN_FREE}, ${PLATFORM}, 'F9 Starter', ${"f9-s-" + CODE}, 0, 'INR', ${ACTOR}, ${ACTOR}),
      (${PLAN_PRO}, ${PLATFORM}, 'F9 Pro', ${"f9-p-" + CODE}, 999900, 'INR', ${ACTOR}, ${ACTOR})`));
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`
    INSERT INTO plans.billing_plan_features (tenant_id, plan_id, feature_key, limit_value, created_by, updated_by) VALUES
      (${PLATFORM}, ${PLAN_PRO}, 'max_users', 250, ${ACTOR}, ${ACTOR}),
      (${PLATFORM}, ${PLAN_PRO}, 'storage_gb', 50, ${ACTOR}, ${ACTOR}),
      (${PLATFORM}, ${PLAN_PRO}, 'max_api_calls', 10000, ${ACTOR}, ${ACTOR}),
      (${PLATFORM}, ${PLAN_PRO}, 'module:finance', NULL, ${ACTOR}, ${ACTOR}),
      (${PLATFORM}, ${PLAN_PRO}, 'module:hrms', NULL, ${ACTOR}, ${ACTOR})`));
  await asTenant(T, async (tx) => {
    await tx.insert(billingSubscriptions).values({ tenantId: T, planId: PLAN_PRO, status: "active", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(billingInvoices).values([
      { tenantId: T, periodMonth: "2026-08", status: "paid", totalMinor: 1180n, taxMinor: 180n, paidMinor: 1180n, supplierGstin: SUP, recipientGstin: REC, placeOfSupply: "07", cgstMinor: 90n, sgstMinor: 90n, issuedAt: new Date("2026-08-02T00:00:00Z"), invoiceSeries: SUP, invoiceNumber: "INV-2627-000007", createdBy: ACTOR, updatedBy: ACTOR },
      { tenantId: T, periodMonth: "2026-09", status: "draft", totalMinor: 500n, createdBy: ACTOR, updatedBy: ACTOR },
      { tenantId: T, periodMonth: "2026-07", status: "cancelled", totalMinor: 700n, issuedAt: new Date("2026-07-02T00:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/tenants/current")) {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (tenantEdition === "down") throw new Error("tenant-service down");
      return new Response(JSON.stringify({ id: T, edition: tenantEdition }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  app = await buildApp();
});
afterEach(() => { tenantEdition = "govt"; seenAuth = undefined; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  await asTenant(T, async (tx) => {
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, T));
    await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, T));
  });
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plan_features WHERE plan_id IN (${PLAN_FREE}, ${PLAN_PRO})`));
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plans WHERE id IN (${PLAN_FREE}, ${PLAN_PRO})`));
  await app.close();
  await sqlClient.end();
});

const get = (roles: string[], tid = T) => app.inject({ method: "GET", url: "/v1/billing/tenant-plans", headers: bearer(roles, tid) });

describe("GET /v1/billing/tenant-plans", () => {
  it("returns plans with limits, the current plan, issued invoices with GST fields and the edition", async () => {
    const r = await get(["tenant_admin"]);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.edition).toBe("govt");
    expect(b.currentPlanId).toBe(PLAN_PRO);
    expect(b.trialDaysLeft).toBeNull();
    const pro = b.plans.find((p: { id: string }) => p.id === PLAN_PRO);
    expect(pro).toMatchObject({ name: "F9 Pro", pricePerMonth: 999900, maxUsers: 250, storageGb: 50, maxApiCalls: 10000 });
    expect([...pro.modules].sort()).toEqual(["finance", "hrms"]);
    // A plan nobody configured limits for is zero, never an invented figure.
    expect(b.plans.find((p: { id: string }) => p.id === PLAN_FREE)).toMatchObject({ maxUsers: 0, storageGb: 0, maxApiCalls: 0, modules: [] });
    // The draft is not a tax invoice yet; the paid and cancelled rows are shown with the right status mapping.
    expect(b.invoices).toHaveLength(2);
    const paid = b.invoices.find((i: { status: string }) => i.status === "paid");
    expect(paid).toMatchObject({
      invoiceNumber: "INV-2627-000007", amount: 1180, supplierGstin: SUP, recipientGstin: REC, placeOfSupply: "07",
      cgstMinor: 90, sgstMinor: 90, igstMinor: 0,
    });
    expect(b.invoices.some((i: { status: string }) => i.status === "failed")).toBe(true);
  });

  it("forwards the caller's own bearer token to tenant-service", async () => {
    await get(["tenant_admin"]);
    expect(seenAuth).toMatch(/^Bearer /);
  });

  it("a tenant-service outage degrades to edition null instead of failing the read", async () => {
    tenantEdition = "down";
    const r = await get(["tenant_admin"]);
    expect(r.statusCode).toBe(200);
    expect(r.json().edition).toBeNull();
    expect(r.json().plans.length).toBeGreaterThan(0);
  });

  it("is scoped to the caller's tenant: another tenant sees none of these invoices or subscription", async () => {
    const r = await get(["tenant_admin"], OTHER);
    expect(r.statusCode).toBe(200);
    expect(r.json().invoices).toEqual([]);
    expect(r.json().currentPlanId).toBe("");
  });

  it("is refused for a role that is not a billing reader", async () => {
    expect((await get(["employee"])).statusCode).toBe(403);
  });
});
