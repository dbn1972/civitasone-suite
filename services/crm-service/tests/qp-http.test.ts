/**
 * Product / pricing / quotation HTTP -> consumer -> DB tests (QP-001..005).
 * Covers product catalogue + active-only selectability, price-book resolution,
 * the quotation discount-approval send-gate, relational line items as paise, and
 * convert-to-order.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000b1";
const OTHER = "aaaaaaaa-3333-4000-8000-0000000000b2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000b1";

function headers(roles = ["crm_admin"], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s-qp" }, SECRET)}`, "x-tenant-id": tenant };
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>, tenant = TENANT): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await scoped(async (tx) => {
      await tx`DELETE FROM crm.orders WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.quotation_line_items WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.quotation_approvals WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.approval_thresholds WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.quotations WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.price_book_items WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.price_books WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.products WHERE tenant_id = ${t}`;
      return 0;
    }, t).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("QP-001 product catalogue", () => {
  it("creates a product, lists it, and filters active-only", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST", url: "/v1/crm/products", headers: headers(),
      payload: { code: "SKU-1", name: "Cloud Licence", unit: "seat", taxRateBps: 1800, priceMinor: "1500000", activeFrom: "2026-01-01", enabled: true },
    });
    expect(create.statusCode).toBe(202);
    await drainQueue();

    const dup = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "SKU-1", name: "Dup" } });
    expect(dup.statusCode).toBe(409);

    // A disabled product must not appear in the active-only list.
    const create2 = await app.inject({
      method: "POST", url: "/v1/crm/products", headers: headers(),
      payload: { code: "SKU-OFF", name: "Retired", priceMinor: "1", enabled: false },
    });
    expect(create2.statusCode).toBe(202);
    await drainQueue();

    const active = await app.inject({ method: "GET", url: "/v1/crm/products?activeOnly=true", headers: headers(["crm_user"]) });
    await app.close();
    const codes = active.json().data.map((p: { code: string }) => p.code);
    expect(codes).toContain("SKU-1");
    expect(codes).not.toContain("SKU-OFF");
    const sku1 = active.json().data.find((p: { code: string }) => p.code === "SKU-1");
    expect(sku1.priceMinor).toBe("1500000"); // paise as string
  });
});

describe("QP-002 price-book resolution", () => {
  it("returns the highest-priority matching book with its items", async () => {
    const app = await buildApp();
    const lowRes = await app.inject({ method: "POST", url: "/v1/crm/price-books", headers: headers(), payload: { name: "Gov Book", segment: "Government", currency: "INR", priority: 10 } });
    const lowId = lowRes.json().id;
    const highRes = await app.inject({ method: "POST", url: "/v1/crm/price-books", headers: headers(), payload: { name: "Default Book", currency: "INR", priority: 20 } });
    const highId = highRes.json().id;
    await drainQueue();

    // Add an item to the high-priority book.
    const prod = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PB-SKU", name: "PB Product", priceMinor: "500000" } });
    await drainQueue();
    const prodRow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'PB-SKU' AND tenant_id = ${TENANT}`);
    const productId = prodRow[0]!.id;
    const item = await app.inject({ method: "PUT", url: `/v1/crm/price-books/${highId}/items`, headers: headers(), payload: { productId, priceMinor: "480000" } });
    expect(item.statusCode).toBe(202);
    await drainQueue();

    const resolve = await app.inject({ method: "GET", url: "/v1/crm/price-books/resolve?segment=Government&currency=INR", headers: headers(["crm_user"]) });
    await app.close();
    expect(resolve.statusCode).toBe(200);
    // Default book (priority 20, wildcard segment) beats Gov book (priority 10).
    expect(resolve.json().data.id).toBe(highId);
    expect(resolve.json().data.items[0].priceMinor).toBe("480000");
    expect(lowId).not.toBe(highId);
  });
});

describe("QP-004 quotation discount-approval send-gate", () => {
  it("blocks send while an exception is unapproved, allows it once approved", async () => {
    const app = await buildApp();
    // Threshold: discounts up to 10% (1000 bps) need no approval.
    const thr = await app.inject({ method: "PUT", url: "/v1/crm/quotation-approvals/thresholds", headers: headers(), payload: { approvalType: "discount", maxDiscountBps: 1000, requiresRole: "crm_admin" } });
    expect(thr.statusCode).toBe(202);
    await drainQueue();

    const quote = await app.inject({ method: "POST", url: "/v1/crm/quotations", headers: headers(), payload: { quoteRef: "Q-APPR-1", templateRef: "T1", totalMinor: "1000000", currency: "INR" } });
    const quotationId = quote.json().id;
    await drainQueue();

    // Request a 25% discount => breaches threshold => pending.
    const req = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/approvals`, headers: headers(["crm_user"]), payload: { approvalType: "discount", discountBps: 2500, reason: "Strategic account" } });
    expect(req.statusCode).toBe(202);
    expect(req.json().approvalStatus).toBe("pending");
    await drainQueue();

    // Send is blocked while the exception is pending.
    const blocked = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/send`, headers: headers() });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe("APPROVAL_REQUIRED");

    // Approve it.
    const approvals = await app.inject({ method: "GET", url: `/v1/crm/quotations/${quotationId}/approvals`, headers: headers() });
    const approvalId = approvals.json().data[0].id;
    const decide = await app.inject({ method: "POST", url: `/v1/crm/quotation-approvals/${approvalId}/decide`, headers: headers(), payload: { decision: "approve" } });
    expect(decide.statusCode).toBe(202);
    await drainQueue();

    // Now the send goes through.
    const sent = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/send`, headers: headers() });
    await app.close();
    expect(sent.statusCode).toBe(202);
  });
});

describe("QP-003 line items (paise) + QP-005 convert-to-order", () => {
  it("persists relational line items as paise and rejects a non-active product", async () => {
    const app = await buildApp();
    const prod = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "LI-SKU", name: "Line Product", priceMinor: "250000", enabled: true } });
    await drainQueue();
    const prodRow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'LI-SKU' AND tenant_id = ${TENANT}`);
    const productId = prodRow[0]!.id;

    const quote = await app.inject({
      method: "POST", url: "/v1/crm/quotations", headers: headers(),
      payload: { quoteRef: "Q-LI-1", templateRef: "T1", currency: "INR", lineItems: [{ productId, description: "10 seats", quantity: 10, unitPriceMinor: "250000", taxRateBps: 1800 }] },
    });
    const quotationId = quote.json().id;
    expect(quote.statusCode).toBe(202);
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ lineTotalMinor: string; unitPriceMinor: string; quantity: number }>>`
      SELECT line_total_minor::text AS "lineTotalMinor", unit_price_minor::text AS "unitPriceMinor", quantity
      FROM crm.quotation_line_items WHERE quotation_id = ${quotationId} AND tenant_id = ${TENANT}`);
    expect(rows.length).toBe(1);
    expect(rows[0]!.lineTotalMinor).toBe("2500000"); // 250000 * 10, exact paise
    expect(rows[0]!.unitPriceMinor).toBe("250000");

    // A disabled product cannot be quoted.
    const off = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "OFF-SKU", name: "Off", enabled: false } });
    await drainQueue();
    const offRow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'OFF-SKU' AND tenant_id = ${TENANT}`);
    const badQuote = await app.inject({
      method: "POST", url: "/v1/crm/quotations", headers: headers(),
      payload: { quoteRef: "Q-BAD-1", templateRef: "T1", lineItems: [{ productId: offRow[0]!.id, description: "x", quantity: 1, unitPriceMinor: "1" }] },
    });
    await app.close();
    expect(badQuote.statusCode).toBe(422);
    expect(badQuote.json().code).toBe("PRODUCT_NOT_SELECTABLE");
  });

  it("converts an accepted quotation into an order (idempotent)", async () => {
    const app = await buildApp();
    const quote = await app.inject({ method: "POST", url: "/v1/crm/quotations", headers: headers(), payload: { quoteRef: "Q-ORD-1", templateRef: "T1", totalMinor: "900000", currency: "INR" } });
    const quotationId = quote.json().id;
    await drainQueue();

    // Cannot convert a draft.
    const early = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/convert-to-order`, headers: headers() });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe("NOT_ACCEPTED");

    // draft -> sent -> accepted.
    await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/send`, headers: headers() });
    await drainQueue();
    await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/accept`, headers: headers() });
    await drainQueue();

    const conv1 = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/convert-to-order`, headers: headers() });
    expect(conv1.statusCode).toBe(202);
    await drainQueue();
    // Re-fire: idempotent, still exactly one order.
    await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/convert-to-order`, headers: headers() });
    await drainQueue();
    await app.close();

    const orders = await scoped((tx) => tx<Array<{ orderRef: string; totalMinor: string }>>`
      SELECT order_ref AS "orderRef", total_minor::text AS "totalMinor" FROM crm.orders WHERE quotation_id = ${quotationId} AND tenant_id = ${TENANT}`);
    expect(orders.length).toBe(1);
    expect(orders[0]!.totalMinor).toBe("900000");
    expect(orders[0]!.orderRef).toContain("ORD-Q-ORD-1");
  });
});

describe("RLS cross-tenant isolation (products)", () => {
  it("another tenant cannot see this tenant's products", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/products", headers: headers(["crm_user"], OTHER) });
    await app.close();
    expect(res.json().data.find((p: { code: string }) => p.code === "SKU-1")).toBeUndefined();
  });
});
