/**
 * F11 (UAT B4, owner decision 2026-10-27): sequential GST invoice numbers per supplier GSTIN and
 * financial year (April to March), consecutive, at most 16 characters, gap-free under
 * concurrency. Pure helpers + real-DB allocation + the issue flow through the real consumers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { billingInvoices, billingInvoiceItems } from "../src/modules/invoices/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerInvoicesConsumers } from "../src/modules/invoices/consumer.js";
import { allocateSeriesSeq } from "../src/modules/invoices/repo.js";
import { fiscalYearCode, formatSeriesInvoiceNumber } from "../src/modules/invoices/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const T1 = randomUUID();
const T2 = randomUUID();
const tok = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["super_admin"], sid: "s-f11" }, SECRET, 3600)}` });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(t: string, fn: (tx: Tx) => Promise<R>) => runWithTenant(t, () => db.transaction(fn)) as Promise<R>;
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();

// Two valid-format supplier GSTINs unique to this file's run.
const SUP_A = "07AAACF1101A1Z5";
const SUP_B = "27AAACF1102B1Z9";
const REC = "07AABCD5678B1Z2";
const gst = (sup: string) => ({ supplierGstin: sup, recipientGstin: REC, placeOfSupply: "07", cgstMinor: 0, sgstMinor: 0, igstMinor: 0 });

describe("fiscalYearCode (pure, IST April to March)", () => {
  it("1 April IST starts a new financial year; 31 March IST belongs to the old one", () => {
    expect(fiscalYearCode(new Date("2026-04-01T00:00:00+05:30"))).toBe("2627");
    expect(fiscalYearCode(new Date("2026-03-31T23:59:59+05:30"))).toBe("2526");
    expect(fiscalYearCode(new Date("2027-03-31T23:59:59+05:30"))).toBe("2627");
  });
  it("uses IST not UTC: 18:30 UTC on 31 March is already 1 April in India", () => {
    expect(fiscalYearCode(new Date("2026-03-31T18:29:59Z"))).toBe("2526");
    expect(fiscalYearCode(new Date("2026-03-31T18:30:00Z"))).toBe("2627");
  });
  it("crosses the century boundary with two-digit years", () => {
    expect(fiscalYearCode(new Date("2099-06-01T00:00:00+05:30"))).toBe("9900");
  });
});

describe("formatSeriesInvoiceNumber (pure)", () => {
  it("is INV-<FY>-<6 digit seq>, at most 16 characters, from the permitted character set", () => {
    const n = formatSeriesInvoiceNumber("2627", 1n);
    expect(n).toBe("INV-2627-000001");
    expect(n.length).toBeLessThanOrEqual(16);
    expect(n).toMatch(/^[A-Za-z0-9/-]{1,16}$/);
    expect(formatSeriesInvoiceNumber("2627", 1234567n)).toBe("INV-2627-1234567");
  });
  it("refuses to exceed 16 characters or start below 1", () => {
    expect(() => formatSeriesInvoiceNumber("2627", 12345678n)).toThrow(/exhausted/);
    expect(() => formatSeriesInvoiceNumber("2627", 0n)).toThrow();
  });
});

describe("allocateSeriesSeq (real DB)", () => {
  const key = `F11${randomUUID().replace(/-/g, "").slice(0, 10)}`.toUpperCase();
  afterAll(async () => { await db.execute(sql`DELETE FROM invoices.billing_invoice_series WHERE supplier_gstin = ${key}`); });

  it("starts at 1 and is consecutive per (supplier, FY); another FY or supplier has its own series", async () => {
    const a1 = await db.transaction((tx) => allocateSeriesSeq(tx, key, "2627"));
    const a2 = await db.transaction((tx) => allocateSeriesSeq(tx, key, "2627"));
    const b1 = await db.transaction((tx) => allocateSeriesSeq(tx, key, "2728"));
    const c1 = await db.transaction((tx) => allocateSeriesSeq(tx, `${key.slice(0, 14)}Z`, "2627"));
    expect([a1, a2, b1, c1]).toEqual([1n, 2n, 1n, 1n]);
    await db.execute(sql`DELETE FROM invoices.billing_invoice_series WHERE supplier_gstin = ${key.slice(0, 14) + "Z"}`);
  });

  it("is gap-free under concurrency: parallel transactions get distinct, consecutive numbers", async () => {
    const got = await Promise.all(Array.from({ length: 12 }, () => db.transaction((tx) => allocateSeriesSeq(tx, key, "2829"))));
    const sorted = got.map(Number).sort((x, y) => x - y);
    expect(sorted).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("a rolled-back allocation hands its number back (no gap)", async () => {
    const before = await db.transaction((tx) => allocateSeriesSeq(tx, key, "2930"));
    await expect(db.transaction(async (tx) => { await allocateSeriesSeq(tx, key, "2930"); throw new Error("boom"); })).rejects.toThrow("boom");
    const after = await db.transaction((tx) => allocateSeriesSeq(tx, key, "2930"));
    expect(after).toBe(before + 1n);
  });
});

describe("issuing invoices allocates the series number", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const created: string[] = [];
  async function wipe() {
    for (const t of [T1, T2]) {
      await asTenant(t, async (tx) => {
        await tx.delete(billingInvoiceItems).where(eq(billingInvoiceItems.tenantId, t));
        await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      });
    }
    await db.execute(sql`DELETE FROM invoices.billing_invoice_series WHERE supplier_gstin IN (${SUP_A}, ${SUP_B})`);
  }
  beforeAll(async () => { registerInvoicesConsumers(queue); await queue.start(); app = await buildApp(); await wipe(); });
  afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

  async function createDraft(tid: string, sup: string, period: string): Promise<string> {
    const r = await app.inject({ method: "POST", url: "/v1/billing/invoices", headers: tok(tid), payload: { tenantId: tid, periodMonth: period, items: [{ description: "Fee", amountMinor: 1000 }], gst: gst(sup) } });
    expect(r.statusCode).toBe(202);
    await drain();
    created.push(r.json().id);
    return r.json().id as string;
  }
  const issue = (tid: string, id: string) => app.inject({ method: "PATCH", url: `/v1/billing/invoices/${id}/issue`, headers: tok(tid) });
  const detail = async (tid: string, id: string) => (await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}`, headers: tok(tid) })).json();

  it("a draft has no invoice number yet", async () => {
    const id = await createDraft(T1, SUP_A, "2026-09");
    expect((await detail(T1, id)).invoiceNumber).toBeNull();
  });

  it("issue assigns INV-<FY>-000001.., consecutive per supplier across customer tenants, separate per supplier", async () => {
    const fy = fiscalYearCode(new Date());
    const ids = [
      await createDraft(T1, SUP_A, "2026-01"), await createDraft(T2, SUP_A, "2026-02"),
      await createDraft(T1, SUP_A, "2026-03"), await createDraft(T1, SUP_B, "2026-04"),
    ];
    const tenants = [T1, T2, T1, T1];
    for (let i = 0; i < ids.length; i++) { expect((await issue(tenants[i]!, ids[i]!)).statusCode).toBe(202); await drain(); }
    const nums = await Promise.all(ids.map((id, i) => detail(tenants[i]!, id)));
    expect(nums.map((d) => d.status)).toEqual(["issued", "issued", "issued", "issued"]);
    expect(nums.map((d) => d.invoiceNumber)).toEqual([`INV-${fy}-000001`, `INV-${fy}-000002`, `INV-${fy}-000003`, `INV-${fy}-000001`]);
    for (const d of nums) expect(d.invoiceNumber.length).toBeLessThanOrEqual(16);
  });

  it("a redelivered issue command does not burn a second number", async () => {
    const fy = fiscalYearCode(new Date());
    const id = await createDraft(T1, SUP_B, "2026-05");
    const msg = { messageId: randomUUID(), type: "billing.invoice.issue", tenantId: T1, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id } };
    await (queue as unknown as { publish(t: string, m: unknown): Promise<void> }).publish("billing.invoice.issue", msg);
    await drain();
    await (queue as unknown as { publish(t: string, m: unknown): Promise<void> }).publish("billing.invoice.issue", msg);
    await drain();
    expect((await detail(T1, id)).invoiceNumber).toBe(`INV-${fy}-000002`);
    const [next] = [await createDraft(T1, SUP_B, "2026-06")];
    await issue(T1, next!); await drain();
    expect((await detail(T1, next!)).invoiceNumber).toBe(`INV-${fy}-000003`);
  });

  it("a legacy issued row without a series number keeps the derived label", async () => {
    const id = randomUUID();
    await asTenant(T1, (tx) => tx.insert(billingInvoices).values({ id, tenantId: T1, periodMonth: "2025-01", status: "issued", totalMinor: 100n, createdBy: ACTOR, updatedBy: ACTOR }));
    expect((await detail(T1, id)).invoiceNumber).toMatch(/^INV-202501-[0-9A-F]{8}$/);
  });
});
