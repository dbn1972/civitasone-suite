/**
 * Inventory ledger source (migration 0027) + the "stock can be issued from the screen" path.
 *
 * Real Postgres + the real in-memory bus. Proves, with no stock-service involved at all:
 *   1. The per-tenant setting `ledgerSource` defaults to "stock" (today's behaviour), is changed only by
 *      the settings roles (tenant_admin included), validates, audits, preserves the other setting and is
 *      tenant-scoped.
 *   2. End to end for one tenant, starting from nothing: create a store and an item (store_keeper / manager),
 *      receive stock into the store, issue part of it, and the balance and ledger fall by exactly that
 *      amount; an issue larger than the stock is rejected and leaves the balance alone.
 *   3. The item picker with masters=inventory finds the item without calling stock-service.
 *   4. tenant_admin can read the registers the list needs, but cannot post stock.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { registerStoreConsumers } from "../src/modules/stores/consumer.js";
import { items, tenantSettings } from "../src/modules/items/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "a7a7a7a7-0000-4000-8000-0000000b0001";
const T_OTHER = "a7a7a7a7-0000-4000-8000-0000000b0002";
const ACTOR = "a7a7a7a7-0000-4000-8000-0000000c0001";
const ADMIN = "a7a7a7a7-0000-4000-8000-0000000c0002";

const hdr = (tenant: string, actor: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "sess-ledger-source" }, SECRET, 3600)}`,
  "x-tenant-id": tenant,
  "content-type": "application/json",
});
const keeper = () => hdr(T, ACTOR, ["store_keeper"]);
const manager = () => hdr(T, ACTOR, ["inventory_manager"]);
const tenantAdmin = (tenant = T) => hdr(tenant, ADMIN, ["tenant_admin"]);

const mq = () => queue as unknown as MemoryQueue;
const drain = () => mq().drain();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;

async function cleanup(): Promise<void> {
  for (const t of [T, T_OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, t));
      await tx.delete(movementLines).where(eq(movementLines.tenantId, t));
      await tx.delete(movements).where(eq(movements.tenantId, t));
      await tx.delete(stockBalances).where(eq(stockBalances.tenantId, t));
      await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
      await tx.delete(stores).where(eq(stores.tenantId, t));
    }));
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerItemConsumers(queue);
  registerStoreConsumers(queue);
  registerMovementConsumers(queue);
  app = await buildApp();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const settingsOf = async (tenant: string, headers = hdr(tenant, ACTOR, ["inventory_manager"])) =>
  (await app.inject({ method: "GET", url: "/v1/inventory/settings", headers })).json().data as { qcMakerChecker: boolean; ledgerSource: string };

describe("ledgerSource setting", () => {
  it("defaults to 'stock' (today's behaviour) for a tenant with no settings row", async () => {
    expect(await settingsOf(T)).toEqual({ qcMakerChecker: true, ledgerSource: "stock" });
  });

  it("only the settings roles can change it; a store keeper and an unrelated role cannot", async () => {
    for (const roles of [["store_keeper"], ["inventory_manager"], ["hr_officer"]]) {
      const res = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T, ACTOR, roles), payload: { ledgerSource: "inventory" } });
      expect(res.statusCode, roles.join()).toBe(403);
    }
  });

  it("rejects an unknown value and an empty body", async () => {
    const bad = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: tenantAdmin(), payload: { ledgerSource: "sap" } });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: tenantAdmin(), payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it("tenant_admin switches it; the QC setting is untouched; the change is audited and tenant-scoped", async () => {
    const off = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T, ADMIN, ["inventory_admin"]), payload: { qcMakerChecker: false } });
    expect(off.statusCode).toBe(202);
    await drain();
    const put = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: tenantAdmin(), payload: { ledgerSource: "inventory" } });
    expect(put.statusCode).toBe(202);
    await drain();

    expect(await settingsOf(T)).toEqual({ qcMakerChecker: false, ledgerSource: "inventory" });
    expect(await settingsOf(T_OTHER)).toEqual({ qcMakerChecker: true, ledgerSource: "stock" });

    const audits = (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T)))))
      .filter((m) => m.topic === "audit.event.record" && (m.payload as Record<string, unknown>).resourceType === "inventory_settings");
    expect(audits.length).toBe(2);
    const last = audits[audits.length - 1]!.payload as { before?: Record<string, unknown>; after?: Record<string, unknown> };
    const snapshot = JSON.stringify(last);
    expect(snapshot).toContain("\"ledgerSource\":\"stock\"");
    expect(snapshot).toContain("\"ledgerSource\":\"inventory\"");
  });

  it("can be switched back to 'stock'", async () => {
    const back = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: tenantAdmin(), payload: { ledgerSource: "stock" } });
    expect(back.statusCode).toBe(202);
    await drain();
    expect((await settingsOf(T)).ledgerSource).toBe("stock");
  });
});

describe("from an item and a store to an issue that reduces the balance (no stock-service)", () => {
  let storeId = "";
  let itemId = "";

  it("a manager creates the store and a store keeper creates the item", async () => {
    const s = await app.inject({ method: "POST", url: "/v1/inventory/stores", headers: manager(), payload: { name: "Main Store", code: "MAIN" } });
    expect(s.statusCode).toBe(202);
    storeId = s.json().id as string;
    const i = await app.inject({ method: "POST", url: "/v1/inventory/items", headers: keeper(), payload: { name: "A4 Paper Ream", sku: "A4-REAM" } });
    expect(i.statusCode).toBe(202);
    itemId = i.json().id as string;
    await drain();

    const stores = (await app.inject({ method: "GET", url: "/v1/inventory/stores", headers: keeper() })).json().data as Array<{ id: string }>;
    expect(stores.map((x) => x.id)).toContain(storeId);
  });

  it("receipt: 100 reams at Rs 250 land in the store", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/receipts", headers: keeper(),
      payload: { toStoreId: storeId, postingDate: "2026-11-12", refNo: "OPEN-1", lines: [{ itemId, qty: 100, rateMinor: 25000 }] },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    const bal = (await app.inject({ method: "GET", url: `/v1/inventory/balances?itemId=${itemId}&storeId=${storeId}`, headers: keeper() })).json().data as Array<{ onHandQty: number; valueMinor: string }>;
    expect(bal[0]?.onHandQty).toBe(100);
    expect(bal[0]?.valueMinor).toBe("2500000");
  });

  it("issue: 30 reams leave the store; balance, value and ledger all move by exactly that", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues", headers: keeper(),
      payload: { fromStoreId: storeId, postingDate: "2026-11-12", reasonCode: "CONSUMPTION", lines: [{ itemId, qty: 30 }] },
    });
    expect(res.statusCode).toBe(202);
    const issueId = res.json().id as string;
    await drain();

    const bal = (await app.inject({ method: "GET", url: `/v1/inventory/balances?itemId=${itemId}&storeId=${storeId}`, headers: keeper() })).json().data as Array<{ onHandQty: number; valueMinor: string }>;
    expect(bal[0]?.onHandQty).toBe(70);
    expect(bal[0]?.valueMinor).toBe("1750000");

    const ledger = (await app.inject({ method: "GET", url: `/v1/inventory/ledger?itemId=${itemId}&movementType=issue`, headers: keeper() })).json().data as Array<{ qtyOut: number; qtyIn: number; balanceQty: number }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ qtyOut: 30, qtyIn: 0, balanceQty: 70 });

    const mv = await app.inject({ method: "GET", url: `/v1/inventory/movements/${issueId}`, headers: keeper() });
    expect(mv.statusCode).toBe(200);
    expect(mv.json().data.status).toBe("posted");
  });

  it("an issue larger than the stock is rejected and the balance stays at 70", async () => {
    const before = mq().dlq.length;
    const res = await app.inject({
      method: "POST", url: "/v1/inventory/issues", headers: keeper(),
      payload: { fromStoreId: storeId, postingDate: "2026-11-12", lines: [{ itemId, qty: 71 }] },
    });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await drain();
    expect(mq().dlq.slice(before).some((d) => d.error.includes("INSUFFICIENT_STOCK"))).toBe(true);
    expect((await app.inject({ method: "GET", url: `/v1/inventory/movements/${id}`, headers: keeper() })).statusCode).toBe(404);
    const bal = (await app.inject({ method: "GET", url: `/v1/inventory/balances?itemId=${itemId}&storeId=${storeId}`, headers: keeper() })).json().data as Array<{ onHandQty: number }>;
    expect(bal[0]?.onHandQty).toBe(70);
  });

  it("the item picker with masters=inventory finds the item and never calls stock-service", async () => {
    const fetchSpy = vi.fn(async () => { throw new Error("stock-service must not be called"); });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await app.inject({ method: "GET", url: "/v1/inventory/item-picker?q=A4&masters=inventory", headers: keeper() });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ inventoryItemId: string | null; kind: string }>; stockAvailable: boolean };
      expect(body.data.map((e) => e.inventoryItemId)).toContain(itemId);
      expect(body.data.every((e) => e.inventoryItemId !== null)).toBe(true);
      expect(body.stockAvailable).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tenant_admin can read items, stores, balances and the ledger, but cannot post stock", async () => {
    for (const url of ["/v1/inventory/items", "/v1/inventory/stores", "/v1/inventory/balances", "/v1/inventory/ledger"]) {
      const res = await app.inject({ method: "GET", url, headers: tenantAdmin() });
      expect(res.statusCode, url).toBe(200);
    }
    const issue = await app.inject({
      method: "POST", url: "/v1/inventory/issues", headers: tenantAdmin(),
      payload: { fromStoreId: storeId, postingDate: "2026-11-12", lines: [{ itemId, qty: 1 }] },
    });
    expect(issue.statusCode).toBe(403);
  });
});
