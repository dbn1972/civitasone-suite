/** GAP-BILLING-INVOICES-06: the caller-scoped invoice list caps results and
 *  honours an optional ?status= filter (verified against the real route). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7e0000-0000-4000-8000-0000000006c1";
const ACTOR = "5e7eacc0-0000-4000-8000-0000000006c1";
const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "sess-inv06" }, SECRET, 3600)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <X>(t: string, fn: (tx: Tx) => Promise<X>) => runWithTenant(t, () => db.transaction(fn)) as Promise<X>;
type AppT = Awaited<ReturnType<typeof buildApp>>;
let app: AppT;

async function wipe() {
  await asTenant(T, async (tx) => { await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, T)); });
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await asTenant(T, async (tx) => {
    const rows = [];
    // 120 issued + 5 draft = 125 total (> the 100 cap). The (tenant, period)
    // unique constraint forces a distinct period_month per row.
    const period = (n: number) => `${2000 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
    for (let i = 0; i < 120; i++) {
      rows.push({ id: `5e7e1006-0000-4000-8000-${String(i).padStart(12, "0")}`, tenantId: T, periodMonth: period(i), status: "issued", totalMinor: 1000n, createdBy: ACTOR, updatedBy: ACTOR });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({ id: `5e7e1006-0000-4000-8000-1${String(i).padStart(11, "0")}`, tenantId: T, periodMonth: period(200 + i), status: "draft", totalMinor: 1000n, createdBy: ACTOR, updatedBy: ACTOR });
    }
    await tx.insert(billingInvoices).values(rows);
  });
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /v1/billing/invoices paging + status filter (GAP-BILLING-INVOICES-06)", () => {
  it("caps the default page at 100 rows (does not return the whole 125)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices", headers: auth(["billing_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(100);
    expect(body.length).toBe(100);
  });

  it("honours ?status=draft (returns only the 5 draft invoices)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices?status=draft", headers: auth(["billing_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ status: string }>;
    expect(body.length).toBe(5);
    expect(body.every((r) => r.status === "draft")).toBe(true);
  });

  it("supports offset paging", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices?status=issued&limit=10&offset=5", headers: auth(["billing_admin"]) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(10);
  });
});
