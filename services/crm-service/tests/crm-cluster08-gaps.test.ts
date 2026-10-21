/**
 * CRM gap cluster 08 (W2 rescan) -- backend half. HTTP -> consumer -> DB:
 *
 *  - GAP-CRM-OPPORTUNITY-AGEING-03: stage-ageing rows carry the owner's display NAME
 *    (resolved from identity-service, fail-open), not just an owner uuid.
 *  - GAP-CRM-PIPELINES-03: pipeline create/edit/delete is admin-only on the SERVER too.
 *  - GAP-CRM-PRICE-BOOKS-01: the editor can show WHO changed a price book (name, not a
 *    uuid), the maker's reason is persisted, every version bump (including a prices-only
 *    edit and a single-price edit) lands in the append-only change history, and the
 *    history is readable (admin-only).
 *  - GAP-CRM-PRODUCTS-01: the catalogue's "last changed" fields come back from the real
 *    API, and a product's quotation / price-book usage is available before it is retired.
 *
 * Identity-service is not running in the suite; its user-summaries endpoint is stubbed on
 * global fetch (the only outbound call these routes make).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { clearDirectoryCache } from "../src/shared/user-directory.js";
import { diffFields, diffPrices, priceSummary, MAX_PRICE_CHANGES } from "../src/modules/price-books/history.js";
import { drainQueue } from "./consumer-harness.js";

// vitest.config.ts sets JWT_SECRET for this service's suite.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const OWNER = randomUUID();
const PIPE_ID = randomUUID();

const NAMES: Record<string, string> = {
  [OWNER]: "Asha Verma",
  [MAKER]: "Meera Iyer",
  [CHECKER]: "Rohit Sen",
};

function headers(roles: string[], opts: { tenant?: string; sub?: string } = {}) {
  const tenant = opts.tenant ?? TENANT;
  return {
    authorization: `Bearer ${signToken({ sub: opts.sub ?? MAKER, tid: tenant, roles, sid: "s-c08" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>, tenant = TENANT): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await scoped(async (tx) => {
      await tx`DELETE FROM crm.price_book_history WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.price_book_items WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.price_books WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.quotation_line_items WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.products WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.deals WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.stage_limits WHERE tenant_id = ${t}`;
      return 0;
    }, t).catch(() => {});
  }
}

/** Stub identity-service's user-summaries endpoint on global fetch. */
function stubIdentity(mode: "ok" | "down" = "ok") {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/identity/internal/user-summaries")) {
      if (mode === "down") throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify(Object.entries(NAMES).map(([id, name]) => ({ id, name }))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return real(input, init);
  });
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearDirectoryCache();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ───────────────────────────────────────────────────────── pure helpers ──
describe("price-book history diff helpers", () => {
  it("diffFields reports only the tracked fields that actually changed", () => {
    const before = { name: "Gov", segment: null, currency: "INR", geography: "north", channel: null, priority: 5, enabled: true };
    const out = diffFields(before, { name: "Gov", segment: "Government", priority: 9, enabled: true, entries: [] });
    expect(out).toEqual([
      { field: "segment", from: null, to: "Government" },
      { field: "priority", from: 5, to: 9 },
    ]);
  });

  it("diffPrices reports added / changed / removed prices and is exact beyond 2^53", () => {
    const big = "9007199254740993"; // 2^53 + 1 -- a JS number would round this
    const out = diffPrices(
      [{ productId: "a", priceMinor: "100" }, { productId: "b", priceMinor: "200" }, { productId: "c", priceMinor: big }],
      [{ productId: "a", priceMinor: "100" }, { productId: "b", priceMinor: "250" }, { productId: "d", priceMinor: "7" }],
    );
    expect(out).toEqual([
      { productId: "b", fromMinor: "200", toMinor: "250" },
      { productId: "d", fromMinor: null, toMinor: "7" },
      { productId: "c", fromMinor: big, toMinor: null },
    ]);
  });

  it("priceSummary caps the stored list but keeps the exact count", () => {
    const many = Array.from({ length: MAX_PRICE_CHANGES + 5 }, (_, i) => ({ productId: `p${i}`, fromMinor: null, toMinor: "1" }));
    const s = priceSummary(many);
    expect(s.prices).toHaveLength(MAX_PRICE_CHANGES);
    expect(s.priceChangeCount).toBe(MAX_PRICE_CHANGES + 5);
  });
});

// ──────────────────────────────── GAP-CRM-OPPORTUNITY-AGEING-03 (owner) ──
describe("GAP-CRM-OPPORTUNITY-AGEING-03: stage-ageing carries the owner's name", () => {
  const OWNED = randomUUID();
  const UNOWNED = randomUUID();

  beforeAll(async () => {
    await scoped((tx) => tx`
      INSERT INTO crm.pipelines (id, tenant_id, name, stages, status, created_by, updated_by)
      VALUES (${PIPE_ID}, ${TENANT}, 'Ageing', ${JSON.stringify([
        { id: randomUUID(), name: "Lead", probability: 10, ordinal: 0 },
        { id: randomUUID(), name: "Negotiation", probability: 60, ordinal: 1 },
        { id: randomUUID(), name: "Won", probability: 100, ordinal: 2 },
      ])}::jsonb, 'active', ${MAKER}, ${MAKER})`.then(() => 0));
    const app = await buildApp();
    const put = await app.inject({
      method: "PUT", url: "/v1/crm/stage-limits", headers: headers(["crm_admin"]),
      payload: { stage: "Negotiation", maxDays: 1 },
    });
    expect(put.statusCode).toBe(202);
    await app.close();
    await drainQueue();
    for (const [id, owner] of [[OWNED, OWNER], [UNOWNED, null]] as const) {
      await scoped((tx) => tx`
        INSERT INTO crm.deals (id, tenant_id, pipeline_id, name, stage, value_minor, currency, status, owner_id, stage_entered_at, created_by, updated_by, version)
        VALUES (${id}, ${TENANT}, ${PIPE_ID}, ${owner ? "Owned deal" : "Unowned deal"}, 'Negotiation', 500000, 'INR', 'active',
                ${owner}, now() - interval '10 days', ${MAKER}, ${MAKER}, 1)`.then(() => 0));
    }
  });

  it("returns ownerName beside ownerId; an ownerless deal gets ownerName null", async () => {
    stubIdentity();
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/deals/stage-ageing", headers: headers(["crm_user"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; ownerId: string | null; ownerName: string | null }>;
    const owned = rows.find((r) => r.id === OWNED)!;
    expect(owned.ownerId).toBe(OWNER);
    expect(owned.ownerName).toBe("Asha Verma");
    const unowned = rows.find((r) => r.id === UNOWNED)!;
    expect(unowned.ownerId).toBeNull();
    expect(unowned.ownerName).toBeNull();
  });

  it("is fail-open: when identity is down the list still loads, with ownerName null", async () => {
    stubIdentity("down");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/deals/stage-ageing", headers: headers(["crm_user"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    const owned = (res.json().data as Array<{ id: string; ownerName: string | null }>).find((r) => r.id === OWNED)!;
    expect(owned.ownerName).toBeNull();
  });
});

// ───────────────────────────────────────────── GAP-CRM-PIPELINES-03 (server) ──
describe("GAP-CRM-PIPELINES-03: pipeline writes are admin-only on the server", () => {
  const body = {
    name: "Gate test",
    stages: [
      { id: randomUUID(), name: "A", probability: 10, ordinal: 1 },
      { id: randomUUID(), name: "B", probability: 50, ordinal: 2 },
      { id: randomUUID(), name: "C", probability: 100, ordinal: 3 },
    ],
  };

  it("refuses a plain crm_user on create, edit and delete (403) ...", async () => {
    const app = await buildApp();
    const id = randomUUID();
    const post = await app.inject({ method: "POST", url: "/v1/crm/pipelines", headers: headers(["crm_user"]), payload: body });
    const patch = await app.inject({ method: "PATCH", url: `/v1/crm/pipelines/${id}`, headers: headers(["crm_user"]), payload: { name: "x", version: 1 } });
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/pipelines/${id}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(post.statusCode).toBe(403);
    expect(patch.statusCode).toBe(403);
    expect(del.statusCode).toBe(403);
  });

  it("... while still letting a crm_user READ pipelines (the board, quotation builder and ageing editor depend on it)", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/crm/pipelines", headers: headers(["crm_user"]) });
    const one = await app.inject({ method: "GET", url: `/v1/crm/pipelines/${PIPE_ID}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(list.statusCode).toBe(200);
    expect(one.statusCode).toBe(200);
  });

  it("admits crm_admin and super_admin to write", async () => {
    const app = await buildApp();
    const a = await app.inject({ method: "POST", url: "/v1/crm/pipelines", headers: headers(["crm_admin"]), payload: body });
    const s = await app.inject({ method: "POST", url: "/v1/crm/pipelines", headers: headers(["super_admin"]), payload: { ...body, name: "Gate test 2" } });
    await app.close();
    expect(a.statusCode).toBe(202);
    expect(s.statusCode).toBe(202);
  });
});

// ───────────────────────────── GAP-CRM-PRICE-BOOKS-01 (name, reason, history) ──
describe("GAP-CRM-PRICE-BOOKS-01: who / why / what for every price-book change", () => {
  let bookId = "";
  let productA = "";
  let productB = "";

  async function productId(code: string): Promise<string> {
    const rows = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = ${code} AND tenant_id = ${TENANT}`);
    return rows[0]!.id;
  }

  beforeAll(async () => {
    stubIdentity();
    const app = await buildApp();
    for (const [code, name] of [["C08-A", "Alpha"], ["C08-B", "Beta"]] as const) {
      const r = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(["crm_admin"]), payload: { code, name, priceMinor: "100000" } });
      expect(r.statusCode).toBe(202);
    }
    await drainQueue();
    productA = await productId("C08-A");
    productB = await productId("C08-B");
    const create = await app.inject({
      method: "POST", url: "/v1/crm/price-books", headers: headers(["crm_admin"], { sub: MAKER }),
      payload: { name: "Gov Book", currency: "INR", priority: 5, entries: [{ productId: productA, priceMinor: "90000" }] },
    });
    expect(create.statusCode).toBe(202);
    bookId = create.json().id;
    await app.close();
    await drainQueue();
  });

  async function history() {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}/history`, headers: headers(["crm_admin"], { sub: CHECKER }) });
    await app.close();
    return res;
  }

  it("version 1 is recorded on create (who, entry count, the added price)", async () => {
    stubIdentity();
    const res = await history();
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ version: number; action: string; changedBy: string; changedByName: string | null; changes: { entryCount: number; prices: Array<{ productId: string; fromMinor: string | null; toMinor: string | null }> } }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, action: "create", changedBy: MAKER, changedByName: "Meera Iyer" });
    expect(rows[0]!.changes.entryCount).toBe(1);
    expect(rows[0]!.changes.prices).toEqual([{ productId: productA, fromMinor: null, toMinor: "90000" }]);
  });

  it("a live edit persists the maker's reason and the before/after price, newest first", async () => {
    stubIdentity();
    const app = await buildApp();
    const patch = await app.inject({
      method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_admin"], { sub: CHECKER }),
      payload: { priority: 9, entries: [{ productId: productA, priceMinor: "85000" }, { productId: productB, priceMinor: "70000" }], reason: "  Revised FY27 tariff  " },
    });
    await app.close();
    expect(patch.statusCode).toBe(202);
    await drainQueue();

    const res = await history();
    const rows = res.json().data as Array<{ version: number; action: string; reason: string | null; changedByName: string | null; changes: { fields: Array<{ field: string; from: unknown; to: unknown }>; prices: Array<{ productId: string; fromMinor: string | null; toMinor: string | null }>; priceChangeCount: number } }>;
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    const v2 = rows[0]!;
    expect(v2.action).toBe("update");
    expect(v2.reason).toBe("Revised FY27 tariff");
    expect(v2.changedByName).toBe("Rohit Sen");
    expect(v2.changes.fields).toEqual([{ field: "priority", from: 5, to: 9 }]);
    expect(v2.changes.priceChangeCount).toBe(2);
    expect(v2.changes.prices).toEqual(expect.arrayContaining([
      { productId: productA, fromMinor: "90000", toMinor: "85000" },
      { productId: productB, fromMinor: null, toMinor: "70000" },
    ]));
  });

  it("a prices-only edit still bumps the version and re-attributes the book to the editor", async () => {
    const before = await scoped((tx) => tx<Array<{ version: number; updated_by: string }>>`SELECT version, updated_by FROM crm.price_books WHERE id = ${bookId}`);
    const app = await buildApp();
    const patch = await app.inject({
      method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_admin"], { sub: MAKER }),
      payload: { entries: [{ productId: productA, priceMinor: "80000" }, { productId: productB, priceMinor: "70000" }] },
    });
    await app.close();
    expect(patch.statusCode).toBe(202);
    await drainQueue();
    const after = await scoped((tx) => tx<Array<{ version: number; updated_by: string }>>`SELECT version, updated_by FROM crm.price_books WHERE id = ${bookId}`);
    expect(after[0]!.version).toBe(before[0]!.version + 1);
    expect(after[0]!.updated_by).toBe(MAKER);
    const rows = (await scoped((tx) => tx<Array<{ version: number; reason: string | null; changes: { fields: unknown[] } }>>`
      SELECT version, reason, changes FROM crm.price_book_history WHERE price_book_id = ${bookId} AND version = ${after[0]!.version}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBeNull();
    expect(rows[0]!.changes.fields).toEqual([]);
  });

  it("a single-price PUT and DELETE are also versioned and recorded", async () => {
    const app = await buildApp();
    const v0 = (await scoped((tx) => tx<Array<{ version: number }>>`SELECT version FROM crm.price_books WHERE id = ${bookId}`))[0]!.version;
    const put = await app.inject({ method: "PUT", url: `/v1/crm/price-books/${bookId}/items`, headers: headers(["crm_admin"], { sub: CHECKER }), payload: { productId: productB, priceMinor: "65000" } });
    expect(put.statusCode).toBe(202);
    await drainQueue();
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/price-books/${bookId}/items/${productB}`, headers: headers(["crm_admin"], { sub: CHECKER }) });
    expect(del.statusCode).toBe(202);
    await app.close();
    await drainQueue();
    const rows = await scoped((tx) => tx<Array<{ version: number; action: string; changes: { prices: Array<{ fromMinor: string | null; toMinor: string | null }> } }>>`
      SELECT version, action, changes FROM crm.price_book_history WHERE price_book_id = ${bookId} AND version > ${v0} ORDER BY version`);
    expect(rows.map((r) => [r.version, r.action])).toEqual([[v0 + 1, "item"], [v0 + 2, "item"]]);
    expect(rows[0]!.changes.prices).toEqual([{ productId: productB, fromMinor: "70000", toMinor: "65000" }]);
    expect(rows[1]!.changes.prices).toEqual([{ productId: productB, fromMinor: "65000", toMinor: null }]);
  });

  it("list / get / resolve return updatedByName (a name, never only the uuid)", async () => {
    stubIdentity();
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/crm/price-books", headers: headers(["crm_user"]) });
    const one = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
    const resolve = await app.inject({ method: "GET", url: "/v1/crm/price-books/resolve?currency=INR", headers: headers(["crm_user"]) });
    await app.close();
    const fromList = (list.json().data as Array<{ id: string; updatedBy: string; updatedByName: string | null }>).find((b) => b.id === bookId)!;
    expect(fromList.updatedBy).toBe(CHECKER);
    expect(fromList.updatedByName).toBe("Rohit Sen");
    expect(one.json().data.updatedByName).toBe("Rohit Sen");
    expect(resolve.json().data.updatedByName).toBe("Rohit Sen");
  });

  it("updatedByName is null (not a uuid) when identity cannot resolve the editor", async () => {
    stubIdentity("down");
    const app = await buildApp();
    const one = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_user"]) });
    await app.close();
    expect(one.statusCode).toBe(200);
    expect(one.json().data.updatedByName).toBeNull();
  });

  it("history is admin-only, tenant-scoped, and 404s for an unknown book", async () => {
    const app = await buildApp();
    const asUser = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}/history`, headers: headers(["crm_user"]) });
    const otherTenant = await app.inject({ method: "GET", url: `/v1/crm/price-books/${bookId}/history`, headers: headers(["crm_admin"], { tenant: OTHER }) });
    const unknown = await app.inject({ method: "GET", url: `/v1/crm/price-books/${randomUUID()}/history`, headers: headers(["crm_admin"]) });
    await app.close();
    expect(asUser.statusCode).toBe(403);
    expect(otherTenant.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });

  it("a reason on its own is not an edit (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/crm/price-books/${bookId}`, headers: headers(["crm_admin"]), payload: { reason: "just because" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ───────────────────────────── GAP-CRM-PRODUCTS-01 (last changed, usage) ──
describe("GAP-CRM-PRODUCTS-01: last-changed fields and usage before retiring a product", () => {
  let productId = "";
  let unusedId = "";
  const QUOTE_1 = randomUUID();
  const QUOTE_2 = randomUUID();

  beforeAll(async () => {
    const app = await buildApp();
    for (const [code, name] of [["C08-USED", "Used product"], ["C08-FREE", "Unused product"]] as const) {
      const r = await app.inject({ method: "POST", url: "/v1/crm/products", headers: headers(["crm_admin"], { sub: MAKER }), payload: { code, name, priceMinor: "1000" } });
      expect(r.statusCode).toBe(202);
    }
    await drainQueue();
    const rows = await scoped((tx) => tx<Array<{ id: string; code: string }>>`SELECT id, code FROM crm.products WHERE tenant_id = ${TENANT} AND code IN ('C08-USED','C08-FREE')`);
    productId = rows.find((r) => r.code === "C08-USED")!.id;
    unusedId = rows.find((r) => r.code === "C08-FREE")!.id;
    // Two quotations (one with two lines for this product) and one price book reference it.
    for (const q of [QUOTE_1, QUOTE_1, QUOTE_2]) {
      await scoped((tx) => tx`
        INSERT INTO crm.quotation_line_items (tenant_id, quotation_id, product_id, description, quantity, unit_price_minor, tax_rate_bps, line_total_minor, ordinal, created_by)
        VALUES (${TENANT}, ${q}, ${productId}, 'line', 1, 1000, 0, 1000, 0, ${MAKER})`.then(() => 0));
    }
    const pb = await app.inject({ method: "POST", url: "/v1/crm/price-books", headers: headers(["crm_admin"]), payload: { name: "Usage Book", currency: "INR", priority: 1, entries: [{ productId, priceMinor: "900" }] } });
    expect(pb.statusCode).toBe(202);
    await app.close();
    await drainQueue();
  });

  it("list and get return updatedAt / updatedBy / updatedByName from the real API", async () => {
    stubIdentity();
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/crm/products", headers: headers(["crm_user"]) });
    const one = await app.inject({ method: "GET", url: `/v1/crm/products/${productId}`, headers: headers(["crm_user"]) });
    await app.close();
    const row = (list.json().data as Array<{ id: string; updatedBy: string; updatedAt: string; updatedByName: string | null }>).find((p) => p.id === productId)!;
    expect(row.updatedBy).toBe(MAKER);
    expect(row.updatedByName).toBe("Meera Iyer");
    expect(Number.isNaN(Date.parse(row.updatedAt))).toBe(false);
    expect(one.json().data.updatedByName).toBe("Meera Iyer");
  });

  it("usage counts DISTINCT quotations and price books that reference the product", async () => {
    const app = await buildApp();
    const used = await app.inject({ method: "GET", url: `/v1/crm/products/${productId}/usage`, headers: headers(["crm_admin"]) });
    const free = await app.inject({ method: "GET", url: `/v1/crm/products/${unusedId}/usage`, headers: headers(["crm_admin"]) });
    await app.close();
    expect(used.statusCode).toBe(200);
    expect(used.json().data).toEqual({ quotations: 2, priceBooks: 1 });
    expect(free.json().data).toEqual({ quotations: 0, priceBooks: 0 });
  });

  it("usage is admin-only, tenant-scoped and 404s for an unknown product", async () => {
    const app = await buildApp();
    const asUser = await app.inject({ method: "GET", url: `/v1/crm/products/${productId}/usage`, headers: headers(["crm_user"]) });
    const otherTenant = await app.inject({ method: "GET", url: `/v1/crm/products/${productId}/usage`, headers: headers(["crm_admin"], { tenant: OTHER }) });
    const unknown = await app.inject({ method: "GET", url: `/v1/crm/products/${randomUUID()}/usage`, headers: headers(["crm_admin"]) });
    await app.close();
    expect(asUser.statusCode).toBe(403);
    expect(otherTenant.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });
});
