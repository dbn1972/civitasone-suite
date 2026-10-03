/**
 * fq-inventory-01 (real Postgres + the real in-memory bus; stock-service stubbed at the HTTP edge):
 *   GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02 -- the "two item masters" cross-reference.
 *   - mapping uniqueness both ways (route 409 + the unique indexes under a real race)
 *   - tenant isolation (API + RLS)
 *   - auto-suggest by exact code/sku, ambiguity excluded, server-verified confirmation
 *   - the single item picker (a linked pair is ONE entry)
 *   - concurrency on linking / unlinking
 *   - unmatched report, linked stock-side balances, audit events, no data loss
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerItemConsumers } from "../src/modules/items/consumer.js";
import { registerItemLinkConsumers } from "../src/modules/item-links/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { items } from "../src/modules/items/schema.js";
import { itemStockLinks } from "../src/modules/item-links/schema.js";
import * as linkRepo from "../src/modules/item-links/repo.js";
import { suggestLinks, mergePicker, normalizeCode } from "../src/modules/item-links/domain.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T1 = "a1a1a1a1-0000-4000-8000-0000000fb001";
const T2 = "a2a2a2a2-0000-4000-8000-0000000fb002";
const ADMIN = "a1a1a1a1-0000-4000-8000-0000000ab001";
const ADMIN2 = "a1a1a1a1-0000-4000-8000-0000000ab002";
const USER = "a1a1a1a1-0000-4000-8000-0000000ab003";
const ADMIN_T2 = "a2a2a2a2-0000-4000-8000-0000000cb001";

// inventory-side items
const INV_PEN = "bbbbbbbb-0000-4000-8000-0000000fb101";   // sku PEN-01  <-> stock PEN-01 (exact, case differs)
const INV_PAPER = "bbbbbbbb-0000-4000-8000-0000000fb102"; // sku PAPER-A <-> stock PAPER-A
const INV_INK = "bbbbbbbb-0000-4000-8000-0000000fb103";   // sku INK-9   -> nothing in stock
const INV_DUP1 = "bbbbbbbb-0000-4000-8000-0000000fb104";  // sku DUP-1   (ambiguous: two stock items with code DUP-1)
const INV_NOSKU = "bbbbbbbb-0000-4000-8000-0000000fb105"; // no sku
const INV_T2 = "bbbbbbbb-0000-4000-8000-0000000fb106";
// stock-side items
const STK_PEN = "cccccccc-0000-4000-8000-0000000fb201";
const STK_PAPER = "cccccccc-0000-4000-8000-0000000fb202";
const STK_STAPLER = "cccccccc-0000-4000-8000-0000000fb203"; // stock only
const STK_DUP_A = "cccccccc-0000-4000-8000-0000000fb204";
const STK_DUP_B = "cccccccc-0000-4000-8000-0000000fb205";
const STK_T2 = "cccccccc-0000-4000-8000-0000000fb206";
const WH = "dddddddd-0000-4000-8000-0000000fb301";

type StockRow = { id: string; tenantId: string; code: string; name: string; uom: string };
const STOCK: StockRow[] = [
  { id: STK_PEN, tenantId: T1, code: "pen-01", name: "Gel Pen Blue", uom: "EA" },
  { id: STK_PAPER, tenantId: T1, code: "PAPER-A", name: "A4 Paper Ream", uom: "RM" },
  { id: STK_STAPLER, tenantId: T1, code: "STAP-1", name: "Heavy Stapler", uom: "EA" },
  { id: STK_DUP_A, tenantId: T1, code: "DUP-1", name: "Dup A", uom: "EA" },
  { id: STK_DUP_B, tenantId: T1, code: "DUP-1", name: "Dup B", uom: "EA" },
  { id: STK_T2, tenantId: T2, code: "PEN-01", name: "Other tenant pen", uom: "EA" },
];

function hdr(tenantId: string, actorId: string, roles: string[]) {
  const token = signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-fq-inv-01" }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}
const admin = (t = T1, a = ADMIN) => hdr(t, a, ["inventory_admin"]);
const plainUser = () => hdr(T1, USER, ["inventory_user"]);

const mq = () => queue as unknown as MemoryQueue;
const drain = () => mq().drain();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

/** stock-service at the HTTP edge: tenant-scoped by the x-tenant-id the client sends. */
function stubStock(opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: { headers?: Record<string, string> }) => {
    if (opts.down) throw new Error("stock-service down");
    const u = new URL(String(url));
    calls.push(`${u.pathname}${u.search}`);
    const tenant = init?.headers?.["x-tenant-id"];
    const mine = STOCK.filter((s) => s.tenantId === tenant);
    const shape = (s: StockRow) => ({ id: s.id, code: s.code, name: s.name, uom: s.uom, isActive: true });
    const bal = u.pathname.match(/^\/v1\/stock\/items\/([^/]+)\/balances$/);
    if (bal) {
      if (!mine.some((s) => s.id === bal[1])) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ itemId: bal[1], totalQty: 30, totalValueMinor: "15000", warehouses: [{ warehouseId: WH, qty: 30, rateMinor: "500", valueMinor: "15000" }] }), { status: 200 });
    }
    const one = u.pathname.match(/^\/v1\/stock\/items\/([^/]+)$/);
    if (one) {
      const s = mine.find((x) => x.id === one[1]);
      return s ? new Response(JSON.stringify(shape(s)), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (u.pathname === "/v1/stock/items") {
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number(u.searchParams.get("limit") ?? "50");
      const offset = Number(u.searchParams.get("offset") ?? "0");
      const rows = mine.filter((s) => q === "" || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return new Response(JSON.stringify({ data: rows.slice(offset, offset + limit).map(shape) }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  }));
  return calls;
}

let app: FastifyInstance;

async function cleanup(): Promise<void> {
  for (const t of [T1, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(itemStockLinks).where(eq(itemStockLinks.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
    }));
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
}

async function seed(): Promise<void> {
  const base = { reorderLevel: 0, reorderQty: 0 };
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.insert(items).values([
      { id: INV_PEN, tenantId: T1, name: "Gel Pen", sku: "PEN-01", ...base, createdBy: ADMIN, updatedBy: ADMIN },
      { id: INV_PAPER, tenantId: T1, name: "A4 Paper", sku: "PAPER-A", ...base, createdBy: ADMIN, updatedBy: ADMIN },
      { id: INV_INK, tenantId: T1, name: "Ink Bottle", sku: "INK-9", ...base, createdBy: ADMIN, updatedBy: ADMIN },
      { id: INV_DUP1, tenantId: T1, name: "Dup Item", sku: "DUP-1", ...base, createdBy: ADMIN, updatedBy: ADMIN },
      { id: INV_NOSKU, tenantId: T1, name: "No Sku Item", sku: null, ...base, createdBy: ADMIN, updatedBy: ADMIN },
    ]).onConflictDoNothing();
  }));
  await runWithTenant(T2, () => db.transaction(async (tx) => {
    await tx.insert(items).values({ id: INV_T2, tenantId: T2, name: "Other Pen", sku: "PEN-01", ...base, createdBy: ADMIN_T2, updatedBy: ADMIN_T2 }).onConflictDoNothing();
  }));
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerItemConsumers(queue);
  registerItemLinkConsumers(queue);
  app = await buildApp();
  await cleanup();
  await seed();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await drain();
  // every test starts with no links
  for (const t of [T1, T2]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(itemStockLinks).where(eq(itemStockLinks.tenantId, t))));
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t))));
  }
  mq().dlq.length = 0;
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const links = async (tenant = T1) =>
  runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(itemStockLinks).where(eq(itemStockLinks.tenantId, tenant))));
const audits = async (tenant: string, action: string) =>
  (await runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenant)))))
    .filter((m) => {
      const p = m.payload as Record<string, unknown>;
      return m.topic === "audit.event.record" && p.resourceType === "item_stock_link" && p.action === action;
    });

async function link(inv: string, stock: string, source: "manual" | "suggested" = "manual", headers = admin()) {
  return app.inject({ method: "POST", url: "/v1/inventory/item-links", headers, payload: { inventoryItemId: inv, stockItemId: stock, source } });
}

describe("pure rules: auto-suggest and the merged picker", () => {
  const inv = [
    { id: "i1", name: "Pen", sku: " pen-01 " }, { id: "i2", name: "Ink", sku: "INK" }, { id: "i3", name: "Blank", sku: "" },
    { id: "i4", name: "D1", sku: "DUP" }, { id: "i5", name: "Linked", sku: "LNK" },
  ];
  const stock = [
    { id: "s1", code: "PEN-01", name: "Gel pen" }, { id: "s2", code: "DUP", name: "D-a" }, { id: "s3", code: "dup", name: "D-b" },
    { id: "s4", code: "LNK", name: "Linked stock" }, { id: "s5", code: "", name: "No code" },
  ];

  it("normalizes case and whitespace; blank never matches", () => {
    expect(normalizeCode("  pen-01 ")).toBe("PEN-01");
    expect(normalizeCode(null)).toBe("");
  });

  it("suggests only exact, unambiguous, unlinked pairs", () => {
    const r = suggestLinks(inv, stock, [{ inventoryItemId: "i5", stockItemId: "s4" }]);
    expect(r.suggestions.map((s) => [s.inventoryItemId, s.stockItemId])).toEqual([["i1", "s1"]]);
    expect(r.ambiguous).toBe(1); // DUP: one inventory item, two stock items
  });

  it("a linked pair is ONE picker entry, however it was found", () => {
    const l = [{ id: "L", inventoryItemId: "i1", stockItemId: "s1", stockItemCode: "PEN-01", stockItemName: "Gel pen" }];
    const invById = new Map(inv.map((i) => [i.id, i]));
    // found via the inventory side only
    expect(mergePicker([inv[0]!], [], l, invById)).toHaveLength(1);
    // found via the stock side only (inventory name did not match the text)
    const viaStock = mergePicker([], [stock[0]!], l, invById);
    expect(viaStock).toHaveLength(1);
    expect(viaStock[0]).toMatchObject({ kind: "linked", inventoryItemId: "i1", stockItemId: "s1" });
    // found via both sides: still one
    expect(mergePicker([inv[0]!], [stock[0]!], l, invById)).toHaveLength(1);
    // unlinked items stay visible and labelled
    const kinds = mergePicker([inv[1]!], [stock[1]!], l, invById).map((e) => e.kind).sort();
    expect(kinds).toEqual(["inventory_only", "stock_only"]);
  });
});

describe("create / remove a link (CQRS, audited)", () => {
  it("an admin links the pair: 202, then one row with a snapshot, one audit event, items untouched", async () => {
    stubStock();
    const before = await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(items).where(eq(items.id, INV_PEN))));
    const res = await link(INV_PEN, STK_PEN);
    expect(res.statusCode).toBe(202);
    await drain();
    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inventoryItemId: INV_PEN, stockItemId: STK_PEN, stockItemCode: "pen-01", stockItemName: "Gel Pen Blue", linkSource: "manual", linkedBy: ADMIN });
    expect((await audits(T1, "link")).length).toBe(1);
    const after = await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(items).where(eq(items.id, INV_PEN))));
    expect(after).toEqual(before); // no data loss, no id rewrite, no master change
  });

  it("only admin roles may link or unlink", async () => {
    stubStock();
    expect((await link(INV_PEN, STK_PEN, "manual", plainUser())).statusCode).toBe(403);
    await link(INV_PEN, STK_PEN);
    await drain();
    const id = (await links())[0]!.id;
    const del = await app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: plainUser() });
    expect(del.statusCode).toBe(403);
    expect((await links())).toHaveLength(1);
  });

  it("404 for an unknown inventory item or a stock item stock-service does not have; 503 when stock is down", async () => {
    stubStock();
    expect((await link(randomUUID(), STK_PEN)).statusCode).toBe(404);
    const noStock = await link(INV_PEN, randomUUID());
    expect(noStock.statusCode).toBe(404);
    expect(noStock.json().code).toBe("STOCK_ITEM_NOT_FOUND");
    vi.unstubAllGlobals();
    stubStock({ down: true });
    const down = await link(INV_PEN, STK_PEN);
    expect(down.statusCode).toBe(503);
    expect(down.json().code).toBe("STOCK_UNAVAILABLE");
    expect(await links()).toHaveLength(0);
  });

  it("validates the body (zod at the boundary)", async () => {
    stubStock();
    const res = await app.inject({ method: "POST", url: "/v1/inventory/item-links", headers: admin(), payload: { inventoryItemId: "nope", stockItemId: STK_PEN } });
    expect(res.statusCode).toBe(400);
  });

  it("unlink removes only the link, audits it, and a second unlink is a 404", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const id = (await links())[0]!.id;
    const del = await app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: admin(T1, ADMIN2) });
    expect(del.statusCode).toBe(202);
    await drain();
    expect(await links()).toHaveLength(0);
    expect((await audits(T1, "unlink")).length).toBe(1);
    expect((await app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: admin() })).statusCode).toBe(404);
    // the items are still there
    const still = await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(items).where(eq(items.id, INV_PEN))));
    expect(still).toHaveLength(1);
  });

  it("re-linking after an unlink works (a repeated decision is never deduped)", async () => {
    stubStock();
    for (let i = 0; i < 2; i += 1) {
      expect((await link(INV_PEN, STK_PEN)).statusCode).toBe(202);
      await drain();
      const id = (await links())[0]!.id;
      expect((await app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: admin() })).statusCode).toBe(202);
      await drain();
    }
    expect(await links()).toHaveLength(0);
    expect((await audits(T1, "link")).length).toBe(2);
    expect((await audits(T1, "unlink")).length).toBe(2);
  });
});

describe("mapping uniqueness, both ways", () => {
  it("one stock item cannot be linked to a second inventory item (409), and vice versa", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const second = await link(INV_PAPER, STK_PEN);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("STOCK_ITEM_ALREADY_LINKED");
    const other = await link(INV_PEN, STK_PAPER);
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe("INVENTORY_ITEM_ALREADY_LINKED");
    await drain();
    expect(await links()).toHaveLength(1);
  });

  it("the unique indexes hold even when the route pre-check is bypassed (commands published directly)", async () => {
    stubStock();
    const publish = (invId: string, stockId: string, code: string) => queue.publish(COMMANDS.itemLinkCreate, {
      messageId: randomUUID(), type: COMMANDS.itemLinkCreate, tenantId: T1, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T1, inventoryItemId: invId, stockItemId: stockId, source: "manual", stockItemCode: code, stockItemName: code },
    });
    await publish(INV_PEN, STK_PEN, "A");
    await publish(INV_PAPER, STK_PEN, "B"); // same stock item, different inventory item
    await publish(INV_PEN, STK_PAPER, "C"); // same inventory item, different stock item
    await drain();
    expect(await links()).toHaveLength(1);
    expect(mq().dlq.length).toBe(2);
    expect((await audits(T1, "link")).length).toBe(1); // the losers wrote no audit event
  });
});

describe("concurrency on linking", () => {
  it("two simultaneous link requests for the same stock item: exactly one row survives, whichever way the race lands", async () => {
    stubStock();
    const [a, b] = await Promise.all([link(INV_PEN, STK_PEN), link(INV_PAPER, STK_PEN, "manual", admin(T1, ADMIN2))]);
    // The in-memory bus can commit the first command before the second route pre-check runs (a clear 409),
    // or both can be accepted and the loser dead-letters on the unique index. Either way: one row, one audit.
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses.every((s) => s === 202 || s === 409)).toBe(true);
    expect(statuses).toContain(202);
    await drain();
    expect(await links()).toHaveLength(1);
    const accepted = statuses.filter((s) => s === 202).length;
    expect(mq().dlq.length).toBe(accepted - 1);
    expect((await audits(T1, "link")).length).toBe(1);
  });

  it("two transactions racing to insert the same pair: the unique index lets exactly one commit", async () => {
    const insert = (id: string, inv: string, by: string) => runWithTenant(T1, () => db.transaction((tx) =>
      linkRepo.insertLink(tx, { id, tenantId: T1, inventoryItemId: inv, stockItemId: STK_PAPER, stockItemCode: "PAPER-A", stockItemName: "A4 Paper Ream", linkSource: "manual", linkedBy: by })));
    const results = await Promise.allSettled([insert(randomUUID(), INV_PAPER, ADMIN), insert(randomUUID(), INV_INK, ADMIN2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await links()).toHaveLength(1);
  });

  it("two unlink commands for one link: one removes it, the other dead-letters without a second audit event", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const id = (await links())[0]!.id;
    const [a, b] = await Promise.all([
      app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: admin() }),
      app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${id}`, headers: admin(T1, ADMIN2) }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await drain();
    expect(await links()).toHaveLength(0);
    expect(mq().dlq.length).toBe(1);
    expect((await audits(T1, "unlink")).length).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("another tenant cannot see, look up, remove or link against this tenant's items", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const row = (await links())[0]!;

    const list = await app.inject({ method: "GET", url: "/v1/inventory/item-links", headers: admin(T2, ADMIN_T2) });
    expect(list.json().data).toEqual([]);
    expect(list.json().total).toBe(0);
    const look = await app.inject({ method: "GET", url: `/v1/inventory/item-links/lookup?inventoryItemId=${INV_PEN}`, headers: admin(T2, ADMIN_T2) });
    expect(look.json().data).toBeNull();
    expect((await app.inject({ method: "DELETE", url: `/v1/inventory/item-links/${row.id}`, headers: admin(T2, ADMIN_T2) })).statusCode).toBe(404);
    // T2 admin tries to link T1's inventory item to its own stock item
    expect((await link(INV_PEN, STK_T2, "manual", admin(T2, ADMIN_T2))).statusCode).toBe(404);
    // and T1's stock item is invisible to T2 (stock-service is tenant scoped)
    expect((await link(INV_T2, STK_PEN, "manual", admin(T2, ADMIN_T2))).statusCode).toBe(404);
    expect(await links()).toHaveLength(1);
    expect(await links(T2)).toHaveLength(0);
  });

  it("RLS: without the tenant GUC the table reads empty, and a cross-tenant insert is refused", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const seenFromT2 = await runWithTenant(T2, () => db.transaction((tx) => tx.select().from(itemStockLinks)));
    expect(seenFromT2).toHaveLength(0);
    await expect(runWithTenant(T2, () => db.transaction((tx) => linkRepo.insertLink(tx, {
      id: randomUUID(), tenantId: T1, inventoryItemId: INV_PAPER, stockItemId: STK_PAPER, stockItemCode: "X", stockItemName: "X", linkSource: "manual", linkedBy: ADMIN,
    })))).rejects.toThrow();
  });

  it("the same sku in two tenants is not a collision: each tenant links its own pair", async () => {
    stubStock();
    expect((await link(INV_PEN, STK_PEN)).statusCode).toBe(202);
    expect((await link(INV_T2, STK_T2, "manual", admin(T2, ADMIN_T2))).statusCode).toBe(202);
    await drain();
    expect(await links()).toHaveLength(1);
    expect(await links(T2)).toHaveLength(1);
  });
});

describe("auto-suggest by exact code/sku", () => {
  it("lists exact matches (case-insensitive), excludes ambiguous and linked ones, admin only", async () => {
    stubStock();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/item-links/suggestions", headers: admin() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((s: { inventoryItemId: string; stockItemId: string }) => [s.inventoryItemId, s.stockItemId]).sort()).toEqual(
      [[INV_PAPER, STK_PAPER], [INV_PEN, STK_PEN]].sort(),
    );
    expect(body.ambiguous).toBe(1);

    await link(INV_PEN, STK_PEN, "suggested");
    await drain();
    const again = (await app.inject({ method: "GET", url: "/v1/inventory/item-links/suggestions", headers: admin() })).json();
    expect(again.data.map((s: { inventoryItemId: string }) => s.inventoryItemId)).toEqual([INV_PAPER]);

    expect((await app.inject({ method: "GET", url: "/v1/inventory/item-links/suggestions", headers: plainUser() })).statusCode).toBe(403);
  });

  it("confirming a suggestion is verified by the server: a non-matching pair is refused as 'suggested'", async () => {
    stubStock();
    const bad = await link(INV_PEN, STK_PAPER, "suggested");
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe("NOT_AN_EXACT_MATCH");
    const ok = await link(INV_PEN, STK_PEN, "suggested");
    expect(ok.statusCode).toBe(202);
    await drain();
    expect((await links())[0]!.linkSource).toBe("suggested");
  });

  it("the item detail offers the single exact-code suggestion, and none once linked or when ambiguous", async () => {
    stubStock();
    const d = (await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_PEN}/stock-link`, headers: admin() })).json().data;
    expect(d.linked).toBe(false);
    expect(d.suggestion).toMatchObject({ stockItemId: STK_PEN, stockItemCode: "pen-01" });
    const dup = (await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_DUP1}/stock-link`, headers: admin() })).json().data;
    expect(dup.suggestion).toBeNull();
    const nosku = (await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_NOSKU}/stock-link`, headers: admin() })).json().data;
    expect(nosku.suggestion).toBeNull();
  });
});

describe("item detail: the linked stock-side balances", () => {
  it("shows the stock item and its balances for a linked item (a role allowed to see valuation)", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const d = (await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_PEN}/stock-link`, headers: admin() })).json().data;
    expect(d.linked).toBe(true);
    expect(d.stockAvailable).toBe(true);
    expect(d.stock.item).toMatchObject({ id: STK_PEN, code: "pen-01" });
    expect(d.stock.balances).toMatchObject({ totalQty: 30, totalValueMinor: "15000" });
  });

  it("when stock-service is down the link is still shown (from its snapshot), flagged unavailable, never an error", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    vi.unstubAllGlobals();
    stubStock({ down: true });
    const res = await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_PEN}/stock-link`, headers: plainUser() });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({ linked: true, stockAvailable: false, stock: null });
    expect(d.link.stockItemCode).toBe("pen-01");
  });

  it("404 for an item that is not in this tenant", async () => {
    stubStock();
    expect((await app.inject({ method: "GET", url: `/v1/inventory/items/${INV_PEN}/stock-link`, headers: admin(T2, ADMIN_T2) })).statusCode).toBe(404);
  });
});

describe("the single item picker", () => {
  it("returns a linked pair as ONE entry whichever side matches the text", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    // "Gel" matches BOTH the inventory name "Gel Pen" and the stock name "Gel Pen Blue"
    const both = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=Gel", headers: plainUser() })).json();
    expect(both.data).toHaveLength(1);
    expect(both.data[0]).toMatchObject({ kind: "linked", inventoryItemId: INV_PEN, stockItemId: STK_PEN });
    // "Blue" matches only the stock side: still the one linked item, named from the inventory master
    const stockSide = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=Blue", headers: plainUser() })).json();
    expect(stockSide.data).toHaveLength(1);
    expect(stockSide.data[0]).toMatchObject({ kind: "linked", inventoryItemId: INV_PEN, stockItemId: STK_PEN, name: "Gel Pen" });
  });

  it("keeps unlinked items visible and labelled, and masters=stock keeps only items that have a stock side", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const all = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=", headers: plainUser() })).json().data as Array<{ kind: string; inventoryItemId: string | null; stockItemId: string | null }>;
    const kind = (inv: string | null, stk: string | null) => all.find((e) => e.inventoryItemId === inv && e.stockItemId === stk)?.kind;
    expect(kind(INV_PEN, STK_PEN)).toBe("linked");
    expect(kind(INV_INK, null)).toBe("inventory_only");
    expect(kind(null, STK_STAPLER)).toBe("stock_only");
    expect(all.filter((e) => e.stockItemId === STK_PEN)).toHaveLength(1);

    const stockOnly = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=&masters=stock", headers: plainUser() })).json().data as Array<{ kind: string; stockItemId: string | null }>;
    expect(stockOnly.every((e) => e.stockItemId !== null)).toBe(true);
    expect(stockOnly.some((e) => e.kind === "inventory_only")).toBe(false);
  });

  it("treats % and _ in the search text literally", async () => {
    stubStock();
    const res = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=%25", headers: plainUser() })).json();
    expect(res.data).toEqual([]);
  });

  it("is tenant scoped, and degrades to the inventory master with stockAvailable=false when stock is down", async () => {
    stubStock();
    const other = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=pen", headers: admin(T2, ADMIN_T2) })).json();
    expect(other.data.every((e: { inventoryItemId: string | null; stockItemId: string | null }) => e.inventoryItemId === INV_T2 || e.stockItemId === STK_T2)).toBe(true);
    vi.unstubAllGlobals();
    stubStock({ down: true });
    const down = (await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=pen", headers: plainUser() })).json();
    expect(down.stockAvailable).toBe(false);
    expect(down.data.map((e: { inventoryItemId: string }) => e.inventoryItemId)).toEqual([INV_PEN]);
  });
});

describe("unlinked items and the admin report", () => {
  it("lists what exists on one side only, with counts and suggestion flags", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    const res = await app.inject({ method: "GET", url: "/v1/inventory/item-links/unmatched", headers: admin() });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    const invOnly = b.data.inventoryOnly.map((i: { id: string }) => i.id).sort();
    expect(invOnly).toEqual([INV_PAPER, INV_INK, INV_DUP1, INV_NOSKU].sort());
    expect(b.data.inventoryOnly.find((i: { id: string }) => i.id === INV_PAPER).hasSuggestion).toBe(true);
    expect(b.data.inventoryOnly.find((i: { id: string }) => i.id === INV_INK).hasSuggestion).toBe(false);
    const stockOnly = b.data.stockOnly.map((s: { id: string }) => s.id).sort();
    expect(stockOnly).toEqual([STK_PAPER, STK_STAPLER, STK_DUP_A, STK_DUP_B].sort());
    expect(b.counts).toMatchObject({ inventoryTotal: 5, inventoryLinked: 1, inventoryUnlinked: 4, stockTotal: 5, stockLinked: 1, stockUnlinked: 4, suggestions: 1, ambiguous: 1 });
    expect(b.stockAvailable).toBe(true);
  });

  it("is admin only, and with stock-service down still reports the inventory side and says so", async () => {
    stubStock();
    expect((await app.inject({ method: "GET", url: "/v1/inventory/item-links/unmatched", headers: plainUser() })).statusCode).toBe(403);
    vi.unstubAllGlobals();
    stubStock({ down: true });
    const res = (await app.inject({ method: "GET", url: "/v1/inventory/item-links/unmatched", headers: admin() })).json();
    expect(res.stockAvailable).toBe(false);
    expect(res.data.stockOnly).toBeNull();
    expect(res.counts.stockTotal).toBeNull();
    expect(res.data.inventoryOnly.length).toBe(5);
  });

  it("the link list is paged with a total and a stable order", async () => {
    stubStock();
    await link(INV_PEN, STK_PEN);
    await link(INV_PAPER, STK_PAPER);
    await drain();
    const p1 = (await app.inject({ method: "GET", url: "/v1/inventory/item-links?limit=1&offset=0", headers: plainUser() })).json();
    const p2 = (await app.inject({ method: "GET", url: "/v1/inventory/item-links?limit=1&offset=1", headers: plainUser() })).json();
    expect(p1.total).toBe(2);
    expect(p1.data).toHaveLength(1);
    expect(p2.data).toHaveLength(1);
    expect(p1.data[0].id).not.toBe(p2.data[0].id);
    const byStock = (await app.inject({ method: "GET", url: `/v1/inventory/item-links/lookup?stockItemId=${STK_PAPER}`, headers: plainUser() })).json();
    expect(byStock.data.inventoryItemId).toBe(INV_PAPER);
    expect((await app.inject({ method: "GET", url: "/v1/inventory/item-links/lookup", headers: plainUser() })).statusCode).toBe(400);
  });
});

describe("stock valuation is not widened to every inventory reader", () => {
  const linked = async () => { stubStock(); await link(INV_PEN, STK_PEN); await drain(); };
  const detail = (roles: string[]) =>
    app.inject({ method: "GET", url: `/v1/inventory/items/${INV_PEN}/stock-link`, headers: hdr(T1, USER, roles) });

  it("inventory_user and store_keeper get the link and item but no balances, no rateMinor, no valueMinor", async () => {
    await linked();
    for (const role of ["inventory_user", "store_keeper"]) {
      const res = await detail([role]);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("rateMinor");
      expect(res.body).not.toContain("valueMinor");
      expect(res.body).not.toContain("totalQty");
      const d = res.json().data;
      expect(d.linked).toBe(true);
      expect(d.link.stockItemCode).toBe("pen-01");
      expect(d.stock.item).toMatchObject({ id: STK_PEN });
      expect(d.stock.balances).toBeNull();
    }
  });

  it("the finance, audit, stock and inventory-management roles do get balances", async () => {
    await linked();
    for (const role of ["inventory_manager", "inventory_admin", "finance_officer", "audit_officer", "stock_manager", "stock_admin", "procurement_officer", "super_admin"]) {
      const d = (await detail([role])).json().data;
      expect(d.stock.balances, role).toMatchObject({ totalQty: 30, totalValueMinor: "15000" });
    }
  });

  it("a restricted reader never makes the balances call to stock-service at all", async () => {
    const calls = stubStock();
    await link(INV_PEN, STK_PEN);
    await drain();
    calls.length = 0;
    await detail(["inventory_user"]);
    expect(calls.some((c) => c.includes("/balances"))).toBe(false);
  });

  it("when the suggestion check cannot reach stock-service the detail says stockAvailable=false", async () => {
    stubStock({ down: true });
    const d = (await detail(["inventory_admin"])).json().data;
    expect(d).toMatchObject({ linked: false, suggestion: null, stockAvailable: false });
  });
});
