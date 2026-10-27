/**
 * GAP-BILLING-GSTN-03 (UAT B4): GET /v1/billing/gstn/returns/prepare?gstin=&period=MM/YYYY returns the
 * totals computed from the caller's own issued invoices for that supplier GSTIN and IST calendar
 * month, so the console can prefill and reconcile the hand-keyed return. Read-only. Real Postgres
 * (FORCE RLS), real Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { istMonthRangeUtc } from "../src/modules/gstn/prepare.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const SUP = "07AAACP0303A1Z5";
const SUP2 = "27AAACP0303A1Z7";
const REC = "07AABCD5678B1Z2";
const bearer = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-g3" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(t: string, fn: (tx: Tx) => Promise<R>) => runWithTenant(t, () => db.transaction(fn)) as Promise<R>;
let app: Awaited<ReturnType<typeof buildApp>>;
let seq = 0;
const base = { createdBy: ACTOR, updatedBy: ACTOR } as const;
const inv = (o: Record<string, unknown>) => ({ periodMonth: `20${10 + ++seq}-01`, ...base, ...o });

beforeAll(async () => {
  app = await buildApp();
  await asTenant(T, (tx) => tx.insert(billingInvoices).values([
    // In scope: intra-state, July 2026 IST.
    inv({ tenantId: T, status: "issued", totalMinor: 11800n, taxMinor: 1800n, supplierGstin: SUP, recipientGstin: REC, placeOfSupply: "07", cgstMinor: 900n, sgstMinor: 900n, issuedAt: new Date("2026-07-10T05:00:00Z") }),
    // In scope: inter-state, paid, issued at 00:30 IST on 1 July (= 19:00Z on 30 June).
    inv({ tenantId: T, status: "paid", totalMinor: 23600n, taxMinor: 3600n, supplierGstin: SUP, recipientGstin: "27AABCD5678B1Z9", placeOfSupply: "27", igstMinor: 3600n, issuedAt: new Date("2026-06-30T19:00:00Z") }),
    // Out: 00:30 IST on 1 August (= 19:00Z on 31 July).
    inv({ tenantId: T, status: "issued", totalMinor: 5900n, taxMinor: 900n, supplierGstin: SUP, recipientGstin: REC, placeOfSupply: "07", cgstMinor: 450n, sgstMinor: 450n, issuedAt: new Date("2026-07-31T19:00:00Z") }),
    // Out: draft, cancelled, other supplier GSTIN.
    inv({ tenantId: T, status: "draft", totalMinor: 1180n, taxMinor: 180n, supplierGstin: SUP }),
    inv({ tenantId: T, status: "cancelled", totalMinor: 1180n, taxMinor: 180n, supplierGstin: SUP, issuedAt: new Date("2026-07-12T05:00:00Z") }),
    inv({ tenantId: T, status: "issued", totalMinor: 9999n, taxMinor: 999n, supplierGstin: SUP2, issuedAt: new Date("2026-07-12T05:00:00Z"), igstMinor: 999n }),
    // In scope but legacy: tax recorded with no CGST/SGST/IGST split.
    inv({ tenantId: T, status: "issued", totalMinor: 1180n, taxMinor: 180n, supplierGstin: SUP, issuedAt: new Date("2026-07-20T05:00:00Z") }),
  ]));
  await asTenant(OTHER, (tx) => tx.insert(billingInvoices).values(inv({ tenantId: OTHER, status: "issued", totalMinor: 77700n, taxMinor: 7700n, supplierGstin: SUP, issuedAt: new Date("2026-07-10T05:00:00Z"), igstMinor: 7700n })));
});
afterAll(async () => {
  for (const t of [T, OTHER]) await asTenant(t, (tx) => tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, t)));
  await app.close();
  await sqlClient.end();
});

const prepare = (qs: string, roles = ["finance_officer"], tid = T) => app.inject({ method: "GET", url: `/v1/billing/gstn/returns/prepare${qs}`, headers: bearer(roles, tid) });

describe("istMonthRangeUtc (pure)", () => {
  it("a month is [00:00 IST on the 1st, 00:00 IST on the 1st of the next month) in UTC", () => {
    const { from, to } = istMonthRangeUtc("07/2026");
    expect(from.toISOString()).toBe("2026-06-30T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-07-31T18:30:00.000Z");
    expect(istMonthRangeUtc("12/2026").to.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("GET /v1/billing/gstn/returns/prepare", () => {
  it("sums the caller's issued invoices for the supplier GSTIN and IST month, in paise strings", async () => {
    const r = await prepare(`?gstin=${SUP}&period=${encodeURIComponent("07/2026")}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      gstin: SUP, period: "07/2026", invoiceCount: 3,
      // taxable = total - tax: 10000 + 20000 + 1000
      totalTaxableMinor: "31000", totalCgstMinor: "900", totalSgstMinor: "900", totalIgstMinor: "3600",
      // the legacy invoice has 180 of tax with no split: surfaced, not silently dropped
      unsplitTaxMinor: "180", unsplitTaxInvoiceCount: 1,
    });
  });

  it("is scoped to the caller's tenant: another tenant's invoices never leak in", async () => {
    const r = await prepare(`?gstin=${SUP}&period=${encodeURIComponent("07/2026")}`, ["finance_officer"], OTHER);
    expect(r.json().data).toMatchObject({ invoiceCount: 1, totalIgstMinor: "7700", totalTaxableMinor: "70000" });
  });

  it("an empty month is zeros, not an error", async () => {
    const r = await prepare(`?gstin=${SUP}&period=${encodeURIComponent("01/2025")}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ invoiceCount: 0, totalTaxableMinor: "0", totalCgstMinor: "0", totalSgstMinor: "0", totalIgstMinor: "0", unsplitTaxMinor: "0" });
  });

  it("validates input (400) and role (403)", async () => {
    expect((await prepare(`?gstin=${SUP}`)).statusCode).toBe(400);
    expect((await prepare(`?gstin=short&period=${encodeURIComponent("07/2026")}`)).statusCode).toBe(400);
    expect((await prepare(`?gstin=${SUP}&period=${encodeURIComponent("13/2026")}`)).statusCode).toBe(400);
    expect((await prepare(`?gstin=${SUP}&period=${encodeURIComponent("07/2026")}`, ["viewer"])).statusCode).toBe(403);
  });
});
