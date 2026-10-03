/** GAP-ADMIN-METERING-02: GET /v1/billing/metering returns paise (as strings), per period, for the caller's tenant only. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { billingUsageAggregates } from "../src/modules/usage/schema.js";
import { lastPeriods, meteringStatus } from "../src/modules/usage/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "5e7d0000-0000-4000-8000-0000000000a1";
const TB = "5e7d0000-0000-4000-8000-0000000000b1";
const ACTOR = "5e7dacc0-0000-4000-8000-0000000000a1";
const auth = (roles: string[], tid = TA) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-met" }, SECRET, 3600)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(t: string, fn: (tx: Tx) => Promise<T>) => runWithTenant(t, () => db.transaction(fn)) as Promise<T>;
const [thisMonth, lastMonth] = lastPeriods(new Date(), 2) as [string, string];

type AppT = Awaited<ReturnType<typeof buildApp>>;
let app: AppT;
async function wipe() {
  for (const t of [TA, TB]) await asTenant(t, async (tx) => {
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, t));
    await tx.delete(billingUsageAggregates).where(eq(billingUsageAggregates.tenantId, t));
  });
}
beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(TA, async (tx) => {
    const base = { tenantId: TA, createdBy: ACTOR, updatedBy: ACTOR };
    await tx.insert(billingInvoices).values([
      { ...base, periodMonth: thisMonth, status: "issued", totalMinor: 250050n },
      { ...base, periodMonth: lastMonth, status: "paid", totalMinor: 1234567890n },
    ]);
    await tx.insert(billingUsageAggregates).values([
      { ...base, metricKey: "api_calls", periodMonth: thisMonth, totalQuantity: 12345n },
      { ...base, metricKey: "users", periodMonth: thisMonth, totalQuantity: 42n },
    ]);
  });
  await asTenant(TB, (tx) => tx.insert(billingInvoices).values({ tenantId: TB, periodMonth: thisMonth, status: "overdue", totalMinor: 999n, createdBy: ACTOR, updatedBy: ACTOR }));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /v1/billing/metering", () => {
  it("returns Rs 2,500.50 as the integer paise string 250050, with the period's usage and a derived status", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/metering?months=2", headers: auth(["super_admin"]) });
    expect(res.statusCode).toBe(200);
    const { data, meta } = res.json();
    expect(meta).toEqual({ unit: "paise", months: 2 });
    expect(data[0]).toEqual({ tenant: TA, billingPeriod: thisMonth, apiCalls: "12345", storage: "0", users: "42", amountMinor: "250050", currency: "INR", status: "pending" });
    expect(data[1]).toMatchObject({ billingPeriod: lastMonth, amountMinor: "1234567890", status: "billed", apiCalls: "0" });
    expect(typeof data[0].amountMinor).toBe("string");
  });

  it("is tenant-scoped (another tenant's invoice is never included) and covers months without an invoice", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/metering?months=3", headers: auth(["platform_admin"], TB) });
    const rows = res.json().data as Array<{ tenant: string; amountMinor: string; status: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.tenant === TB)).toBe(true);
    expect(rows[0]).toMatchObject({ amountMinor: "999", status: "overdue" });
    expect(rows[2]).toMatchObject({ amountMinor: "0", status: "unbilled" });
  });

  it("is platform staff only and validates months", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/billing/metering", headers: auth(["tenant_admin"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/billing/metering" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/billing/metering?months=0", headers: auth(["super_admin"]) })).statusCode).toBe(400);
  });

  it("derives the status vocabulary from the invoice status", () => {
    expect(meteringStatus(undefined)).toBe("unbilled");
    expect(meteringStatus("draft")).toBe("draft");
    expect(meteringStatus("partially_paid")).toBe("pending");
    expect(meteringStatus("waived")).toBe("waived");
    expect(lastPeriods(new Date(Date.UTC(2026, 0, 15)), 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });
});
