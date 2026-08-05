/**
 * Extra QP CRUD coverage: product update/delete, price-book patch/delete/items,
 * and the order consumer'\''s "quotation not accepted" rejection branch (QP-001/002/005).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-4444-4000-8000-0000000000c1";
const ACTOR = "cccccccc-4444-4000-8000-0000000000c1";

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-qpx" }, SECRET)}`, "x-tenant-id": TENANT };
}
function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function cleanup() {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.orders WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.quotations WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.price_book_items WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.price_books WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.products WHERE tenant_id = ${TENANT}`;
    return 0;
  }).catch(() => {});
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

describe("QP-001 product update / delete", () => {
  it("patches a product and soft-disables it on delete", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "UPD-1", name: "Before", priceMinor: "100" } });
    await drainQueue();
    const row = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'UPD-1' AND tenant_id = ${TENANT}`);
    const id = row[0]!.id;

    const notFound = await app.inject({ method: "GET", url: "/v1/crm/products/aaaaaaaa-0000-4000-8000-000000000000", headers: headers(["crm_user"]) });
    expect(notFound.statusCode).toBe(404);

    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/products/${id}`, headers: headers(), payload: { name: "After", priceMinor: "250", taxRateBps: 500, category: "Cat" } });
    expect(patch.statusCode).toBe(202);
    await drainQueue();
    const get = await app.inject({ method: "GET", url: `/v1/crm/products/${id}`, headers: headers(["crm_user"]) });
    expect(get.json().data.name).toBe("After");
    expect(get.json().data.priceMinor).toBe("250");

    const del = await app.inject({ method: "DELETE", url: `/v1/crm/products/${id}`, headers: headers() });
    expect(del.statusCode).toBe(202);
    await drainQueue();
    const after = await app.inject({ method: "GET", url: `/v1/crm/products/${id}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(after.json().data.enabled).toBe(false);
  });
});

describe("QP-002 price-book patch / delete / item delete", () => {
  it("patches a book, lists it, removes an item, and deletes the book", async () => {
    const app = await buildApp();
    const create = await app.inject({ method: "POST", url: "/v1/crm/price-books", headers: headers(), payload: { name: "Book", currency: "INR", priority: 5 } });
    const bookId = create.json().id;
    await drainQueue();

    const prod = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBX-1", name: "P", priceMinor: "100" } });
    await drainQueue();
    const prow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'PBX-1' AND tenant_id = ${TENANT}`);
    const productId = prow[0]!.id;

    await app.inject({ method: "PUT", url: `/v1/crm/price-books/${bookId}/items`, headers: headers(), payload: { productId, priceMinor: "90" } });
    await drainQueue();

    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(), payload: { priority: 50, segment: "Gov", enabled: true } });
    expect(patch.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({ method: "GET", url: "/v1/crm/price-books", headers: headers(["crm_user"]) });
    expect(list.json().data.find((b: { id: string }) => b.id === bookId).priority).toBe(50);

    const getOne = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
    expect(getOne.json().data.items.length).toBe(1);

    const delItem = await app.inject({ method: "DELETE", url: `/v1/crm/price-books/${bookId}/items/${productId}`, headers: headers() });
    expect(delItem.statusCode).toBe(202);
    await drainQueue();
    const afterItem = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
    expect(afterItem.json().data.items.length).toBe(0);

    const delBook = await app.inject({ method: "DELETE", url: `/v1/crm/price-books/${bookId}`, headers: headers() });
    expect(delBook.statusCode).toBe(202);
    await drainQueue();
    const gone = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(gone.statusCode).toBe(404);
  });

  it("resolve returns null when nothing matches", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/price-books/resolve?segment=NoSuchSegment&currency=USD", headers: headers(["crm_user"]) });
    await app.close();
    expect(res.json().data).toBeNull();
  });
});

describe("QP-005 order consumer rejects a non-accepted quotation", () => {
  it("does not create an order when the quotation is not accepted", async () => {
    const app = await buildApp();
    const quote = await app.inject({ method: "POST", url: "/v1/crm/quotations", headers: headers(), payload: { quoteRef: "Q-REJ-1", templateRef: "T1", totalMinor: "500000", currency: "INR" } });
    const quotationId = quote.json().id;
    await app.close();
    await drainQueue();

    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.convertQuotationToOrder);
    await runWithTenant(TENANT, () => handler(envelope(COMMANDS.convertQuotationToOrder, {
      id: "abcdef00-4444-4000-8000-000000000099", tenantId: TENANT, quotationId,
      quotationVersion: 1, dealId: null, orderRef: "ORD-Q-REJ-1-v1", totalMinor: "500000", currency: "INR",
    }, { tenantId: TENANT, actorId: ACTOR })));

    const orders = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.orders WHERE quotation_id = ${quotationId} AND tenant_id = ${TENANT}`);
    expect(orders.length).toBe(0);
  });
});
