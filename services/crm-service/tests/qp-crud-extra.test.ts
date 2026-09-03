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

  // Regression coverage for the bug this whole describe block predates: createBody/
  // updateBody had no `entries` field at all, so Zod silently stripped whatever
  // PriceBookEditor.tsx sent on save and the consumer never touched
  // crm.price_book_items — a book always "saved" with zero prices no matter what the
  // admin entered. These tests go through the real HTTP create/update/list/get surface
  // (not a direct repo call) so they catch the whole round trip, including the separate
  // read-side gap where GET /v1/crm/price-books never attached `items` at all and the
  // frontend read the wrong key (`entries` instead of the real `items`) — both would
  // make a book LOOK empty even once the write itself was fixed.
  describe("QP-002 price-book entries (create/update round trip, not silently discarded)", () => {
    it("POST /v1/crm/price-books with entries persists them and reload (GET by id) shows them", async () => {
      const app = await buildApp();
      const p1 = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-1", name: "Widget", priceMinor: "100" } });
      const p2 = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-2", name: "Gadget", priceMinor: "200" } });
      await drainQueue();
      const rows = await scoped((tx) => tx<Array<{ id: string; code: string }>>`SELECT id, code FROM crm.products WHERE code IN ('PBE-1','PBE-2') AND tenant_id = ${TENANT}`);
      const id1 = rows.find((r) => r.code === "PBE-1")!.id;
      const id2 = rows.find((r) => r.code === "PBE-2")!.id;

      const create = await app.inject({
        method: "POST", url: "/v1/crm/price-books", headers: headers(),
        payload: { name: "Entries Book", currency: "INR", priority: 1, entries: [{ productId: id1, priceMinor: "90" }, { productId: id2, priceMinor: "190" }] },
      });
      expect(create.statusCode).toBe(202);
      const bookId = create.json().id;
      await drainQueue();

      // Real DB state — proves the consumer actually persisted crm.price_book_items,
      // not just that the command was accepted. Compared order-independently: both
      // rows are upserted sequentially inside the SAME transaction, and Postgres's
      // now() (== transaction_timestamp()) is fixed for the whole transaction, so
      // `created_at` cannot distinguish insertion order between them — nothing in the
      // domain promises price-book entries preserve insertion order either.
      const items = await scoped((tx) => tx<Array<{ productId: string; priceMinor: string }>>`
        SELECT product_id AS "productId", price_minor::text AS "priceMinor" FROM crm.price_book_items
        WHERE tenant_id = ${TENANT} AND price_book_id = ${bookId}
      `);
      expect(items).toEqual(expect.arrayContaining([
        { productId: id1, priceMinor: "90" },
        { productId: id2, priceMinor: "190" },
      ]));
      expect(items.length).toBe(2);

      // "Reload" — the actual HTTP surface the frontend uses after a save (load()).
      const getOne = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
      expect(getOne.json().data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ productId: id1, priceMinor: "90" }),
        expect.objectContaining({ productId: id2, priceMinor: "190" }),
      ]));

      // The list view (what PriceBookEditor.tsx actually renders rows from, and what its
      // "Edit" action re-opens as the draft) must ALSO carry items — it used to never
      // attach them at all, so every book looked like it had 0 saved prices.
      const list = await app.inject({ method: "GET", url: "/v1/crm/price-books", headers: headers(["crm_user"]) });
      const listed = list.json().data.find((b: { id: string }) => b.id === bookId);
      expect(listed.items).toHaveLength(2);
      await app.close();
    });

    it("PATCH /v1/crm/price-books/:id with entries REPLACES the existing set (removed rows disappear, new rows appear)", async () => {
      const app = await buildApp();
      const p1 = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-3", name: "Kept", priceMinor: "100" } });
      const p2 = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-4", name: "Removed", priceMinor: "100" } });
      const p3 = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-5", name: "Added", priceMinor: "100" } });
      await drainQueue();
      const rows = await scoped((tx) => tx<Array<{ id: string; code: string }>>`SELECT id, code FROM crm.products WHERE code IN ('PBE-3','PBE-4','PBE-5') AND tenant_id = ${TENANT}`);
      const kept = rows.find((r) => r.code === "PBE-3")!.id;
      const removed = rows.find((r) => r.code === "PBE-4")!.id;
      const added = rows.find((r) => r.code === "PBE-5")!.id;

      const create = await app.inject({
        method: "POST", url: "/v1/crm/price-books", headers: headers(),
        payload: { name: "Replace Book", currency: "INR", entries: [{ productId: kept, priceMinor: "50" }, { productId: removed, priceMinor: "60" }] },
      });
      const bookId = create.json().id;
      await drainQueue();

      // Simulate the editor: load the book (2 entries), remove one row, edit another's
      // price, add a new row, then Save — the request carries the FULL resulting set.
      const patch = await app.inject({
        method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(),
        payload: { entries: [{ productId: kept, priceMinor: "55" }, { productId: added, priceMinor: "70" }] },
      });
      expect(patch.statusCode).toBe(202);
      await drainQueue();

      const items = await scoped((tx) => tx<Array<{ productId: string; priceMinor: string }>>`
        SELECT product_id AS "productId", price_minor::text AS "priceMinor" FROM crm.price_book_items
        WHERE tenant_id = ${TENANT} AND price_book_id = ${bookId} ORDER BY created_at ASC
      `);
      expect(items).toHaveLength(2);
      expect(items.find((i) => i.productId === kept)?.priceMinor).toBe("55");
      expect(items.find((i) => i.productId === added)?.priceMinor).toBe("70");
      expect(items.some((i) => i.productId === removed)).toBe(false);
      await app.close();
    });

    it("PATCH /v1/crm/price-books/:id WITHOUT entries leaves existing prices untouched", async () => {
      const app = await buildApp();
      const prod = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(), payload: { code: "PBE-6", name: "Untouched", priceMinor: "100" } });
      await drainQueue();
      const prow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = 'PBE-6' AND tenant_id = ${TENANT}`);
      const productId = prow[0]!.id;

      const create = await app.inject({
        method: "POST", url: "/v1/crm/price-books", headers: headers(),
        payload: { name: "Untouched Book", currency: "INR", entries: [{ productId, priceMinor: "42" }] },
      });
      const bookId = create.json().id;
      await drainQueue();

      const patch = await app.inject({ method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(), payload: { priority: 9 } });
      expect(patch.statusCode).toBe(202);
      await drainQueue();

      const items = await scoped((tx) => tx<Array<{ priceMinor: string }>>`
        SELECT price_minor::text AS "priceMinor" FROM crm.price_book_items WHERE tenant_id = ${TENANT} AND price_book_id = ${bookId}
      `);
      expect(items).toEqual([{ priceMinor: "42" }]);
      await app.close();
    });
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
