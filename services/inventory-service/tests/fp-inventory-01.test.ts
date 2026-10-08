/**
 * fp-inventory-01 finish batch (real Postgres + the real in-memory bus):
 *   - GOODS-RETURNS-DETAIL-04: per-tenant QC maker != checker (route 403, consumer conditional UPDATE, race)
 *   - BINS-03: activate / deactivate a bin (conditional transition, audit event)
 *   - SUBSTITUTES-04: bulk tenant-scoped substitutes read
 *   - GOODS-RETURNS-DETAIL-05 / CYCLE-COUNTS-DETAIL-03: names resolved from identity-service (best-effort)
 *   - RECEIPTS-03: GRN number / PO / supplier on receipt ledger rows
 *   - CYCLE-COUNTS-DETAIL-05: movement detail (lines + poster name) for the adjustment link
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
import { registerMovementConsumers } from "../src/modules/movements/consumer.js";
import { registerStoreConsumers } from "../src/modules/stores/consumer.js";
import { COMMANDS, CONSUMED } from "../src/topics.js";
import { items, itemSubstitutes, bins, goodsReturns, tenantSettings } from "../src/modules/items/schema.js";
import { movements, movementLines, stockBalances, stockLedger } from "../src/modules/movements/schema.js";
import { stores } from "../src/modules/stores/schema.js";
import { cycleCounts } from "../src/modules/cycle-count/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { clearIdentityNameCache } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T1 = "f1f1f1f1-0000-4000-8000-0000000fa001";
const T2 = "f2f2f2f2-0000-4000-8000-0000000fa002";
const MAKER = "f1f1f1f1-0000-4000-8000-0000000aa001";
const CHECKER = "f1f1f1f1-0000-4000-8000-0000000aa002";
const CHECKER2 = "f1f1f1f1-0000-4000-8000-0000000aa003";
const ADMIN = "f1f1f1f1-0000-4000-8000-0000000aa004";
const ACTOR_T2 = "f2f2f2f2-0000-4000-8000-0000000bb001";
const ITEM1 = "cccccccc-0000-4000-8000-0000000fa101";
const ITEM2 = "cccccccc-0000-4000-8000-0000000fa102";
const ITEM_T2 = "cccccccc-0000-4000-8000-0000000fa103";
const STORE1 = "eeeeeeee-0000-4000-8000-0000000fa201";
const VENDOR = "dddddddd-0000-4000-8000-0000000fa301";

function hdr(tenantId: string, actorId: string, roles: string[]) {
  const token = signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-fp-inv-01" }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "content-type": "application/json" };
}
const mgr = (tenant: string, actor: string) => hdr(tenant, actor, ["inventory_manager"]);

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
  for (const t of [T1, T2]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stockLedger).where(eq(stockLedger.tenantId, t));
      await tx.delete(movementLines).where(eq(movementLines.tenantId, t));
      await tx.delete(movements).where(eq(movements.tenantId, t));
      await tx.delete(stockBalances).where(eq(stockBalances.tenantId, t));
      await tx.delete(goodsReturns).where(eq(goodsReturns.tenantId, t));
      await tx.delete(bins).where(eq(bins.tenantId, t));
      await tx.delete(itemSubstitutes).where(eq(itemSubstitutes.tenantId, t));
      await tx.delete(tenantSettings).where(eq(tenantSettings.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
      await tx.delete(stores).where(eq(stores.tenantId, t));
      await tx.delete(cycleCounts).where(eq(cycleCounts.tenantId, t));
    }));
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
}

async function seed(): Promise<void> {
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.insert(items).values([
      { id: ITEM1, tenantId: T1, name: "FP Gel Pen", sku: "FP-1", reorderLevel: 0, reorderQty: 0, createdBy: MAKER, updatedBy: MAKER },
      { id: ITEM2, tenantId: T1, name: "FP Ball Pen", sku: "FP-2", reorderLevel: 0, reorderQty: 0, createdBy: MAKER, updatedBy: MAKER },
    ]).onConflictDoNothing();
    await tx.insert(stores).values({ id: STORE1, tenantId: T1, name: "FP Store", code: "FP-S1", createdBy: MAKER, updatedBy: MAKER }).onConflictDoNothing();
  }));
  await runWithTenant(T2, () => db.transaction(async (tx) => {
    await tx.insert(items).values({ id: ITEM_T2, tenantId: T2, name: "Other tenant item", sku: "FP-T2", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR_T2, updatedBy: ACTOR_T2 }).onConflictDoNothing();
  }));
}

beforeAll(async () => {
  wireTenantAwareQueue(queue);
  registerItemConsumers(queue);
  registerStoreConsumers(queue);
  registerMovementConsumers(queue);
  app = await buildApp();
  await cleanup();
  await seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearIdentityNameCache();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function createReturn(by: string = MAKER): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/inventory/goods-returns", headers: mgr(T1, by),
    payload: { originalIssueId: randomUUID(), itemId: ITEM1, storeId: STORE1, qty: 2, reason: "fp-inventory-01" },
  });
  expect(res.statusCode).toBe(202);
  await drain();
  return res.json().id as string;
}
const row = async (id: string) =>
  (await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(goodsReturns).where(eq(goodsReturns.id, id)))))[0]!;
const auditCount = async (tenant: string, resourceType: string, action: string, resourceId: string) =>
  (await runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenant))))).filter((m) => {
    const p = m.payload as Record<string, unknown>;
    return m.topic === "audit.event.record" && p.resourceType === resourceType && p.action === action && p.resourceId === resourceId;
  }).length;

describe("GAP-INVENTORY-GOODS-RETURNS-DETAIL-04: QC maker != checker", () => {
  it("settings default to ON; reading needs a reader role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/inventory/settings", headers: mgr(T1, MAKER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ qcMakerChecker: true });
    const denied = await app.inject({ method: "GET", url: "/v1/inventory/settings", headers: hdr(T1, MAKER, ["citizen"]) });
    expect(denied.statusCode).toBe(403);
  });

  it("the creator cannot record the verdict (403 MAKER_CHECKER) and nothing reaches the queue", async () => {
    const id = await createReturn();
    const before = mq().dlq.length;
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: mgr(T1, MAKER),
      payload: { qcStatus: "passed", disposition: "restock" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER");
    await drain();
    expect((await row(id)).qcStatus).toBe("pending");
    expect(mq().dlq.length).toBe(before);
  });

  it("a different inspector can record it, and the decision is audited", async () => {
    const id = await createReturn();
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: mgr(T1, CHECKER),
      payload: { qcStatus: "passed", disposition: "restock" },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    const r = await row(id);
    expect(r.qcStatus).toBe("passed");
    expect(r.qcInspectedBy).toBe(CHECKER);
    expect(await auditCount(T1, "goods_return", "inspect", id)).toBe(1);
  });

  it("consumer defence in depth: a creator verdict published directly is dead-lettered and the return stays pending", async () => {
    const id = await createReturn();
    const before = mq().dlq.length;
    await queue.publish(COMMANDS.goodsReturnInspect, {
      messageId: randomUUID(), type: COMMANDS.goodsReturnInspect, tenantId: T1, actorId: MAKER,
      correlationId: "corr-fp-mc", schemaVersion: "1.0",
      payload: { id, tenantId: T1, inspectedBy: MAKER, qcStatus: "passed", disposition: "restock" },
    });
    await drain();
    expect((await row(id)).qcStatus).toBe("pending");
    expect(mq().dlq.slice(before).some((d) => d.error.includes("QC_NOT_PENDING_OR_MAKER"))).toBe(true);
  });

  it("race: two different inspectors decide at once -> exactly one verdict is applied", async () => {
    const id = await createReturn();
    const before = mq().dlq.length;
    const publishAs = (actor: string, qcStatus: string, disposition: string) =>
      queue.publish(COMMANDS.goodsReturnInspect, {
        messageId: randomUUID(), type: COMMANDS.goodsReturnInspect, tenantId: T1, actorId: actor,
        correlationId: "corr-fp-race", schemaVersion: "1.0",
        payload: { id, tenantId: T1, inspectedBy: actor, qcStatus, disposition },
      });
    await Promise.all([publishAs(CHECKER, "passed", "restock"), publishAs(CHECKER2, "failed", "scrap")]);
    await drain();
    const r = await row(id);
    expect(["passed", "failed"]).toContain(r.qcStatus);
    expect(r.version).toBe(2); // bumped exactly once
    expect(mq().dlq.slice(before).filter((d) => d.error.includes("QC_NOT_PENDING_OR_MAKER"))).toHaveLength(1);
  });

  it("only an admin may change the policy; turning it OFF lets the creator inspect; the change is audited", async () => {
    const denied = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T1, MAKER, ["store_keeper"]), payload: { qcMakerChecker: false } });
    expect(denied.statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T1, ADMIN, ["inventory_admin"]), payload: { qcMakerChecker: "no" } });
    expect(bad.statusCode).toBe(400);

    const off = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T1, ADMIN, ["inventory_admin"]), payload: { qcMakerChecker: false } });
    expect(off.statusCode).toBe(202);
    await drain();
    const get = await app.inject({ method: "GET", url: "/v1/inventory/settings", headers: mgr(T1, MAKER) });
    expect(get.json().data.qcMakerChecker).toBe(false);
    expect(await auditCount(T1, "inventory_settings", "update", T1)).toBe(1);
    // the audit event records what changed: before (default ON) and after (OFF)
    const audits = (await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1)))))
      .filter((m) => m.topic === "audit.event.record" && (m.payload as Record<string, unknown>).resourceType === "inventory_settings");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({ before: { qcMakerChecker: true }, after: { qcMakerChecker: false } });

    const id = await createReturn();
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: mgr(T1, MAKER),
      payload: { qcStatus: "failed", disposition: "quarantine" },
    });
    expect(res.statusCode).toBe(202);
    await drain();
    expect((await row(id)).qcStatus).toBe("failed");

    // a second change must not be dropped by the idempotency inbox (fresh messageId per command)
    const on = await app.inject({ method: "PUT", url: "/v1/inventory/settings", headers: hdr(T1, ADMIN, ["inventory_admin"]), payload: { qcMakerChecker: true } });
    expect(on.statusCode).toBe(202);
    await drain();
    expect((await app.inject({ method: "GET", url: "/v1/inventory/settings", headers: mgr(T1, MAKER) })).json().data.qcMakerChecker).toBe(true);
    const second = (await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1)))))
      .filter((m) => m.topic === "audit.event.record" && (m.payload as Record<string, unknown>).resourceType === "inventory_settings");
    expect(second.map((m) => JSON.stringify((m.payload as Record<string, unknown>).before))).toContain(JSON.stringify({ qcMakerChecker: false }));
  });

  it("settings are tenant-scoped", async () => {
    const t2 = await app.inject({ method: "GET", url: "/v1/inventory/settings", headers: mgr(T2, ACTOR_T2) });
    expect(t2.json().data.qcMakerChecker).toBe(true);
  });
});

describe("GAP-INVENTORY-BINS-03: activate / deactivate a bin", () => {
  async function createBin(code: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/v1/inventory/bins", headers: mgr(T1, MAKER), payload: { storeId: STORE1, code } });
    expect(res.statusCode).toBe(202);
    await drain();
    return res.json().id as string;
  }
  const binRow = async (id: string) =>
    (await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(bins).where(eq(bins.id, id)))))[0]!;

  it("deactivates then reactivates; repeats are a 409; every change is audited and bumps the version", async () => {
    const id = await createBin("FP-BIN-1");
    const off = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${id}/status`, headers: mgr(T1, CHECKER), payload: { isActive: false } });
    expect(off.statusCode).toBe(202);
    await drain();
    let b = await binRow(id);
    expect(b.isActive).toBe(false);
    expect(b.version).toBe(2);
    expect(b.updatedBy).toBe(CHECKER);

    const again = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${id}/status`, headers: mgr(T1, CHECKER), payload: { isActive: false } });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("NO_CHANGE");

    const on = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${id}/status`, headers: mgr(T1, CHECKER), payload: { isActive: true } });
    expect(on.statusCode).toBe(202);
    await drain();
    b = await binRow(id);
    expect(b.isActive).toBe(true);
    expect(b.version).toBe(3);
    expect(await auditCount(T1, "bin", "deactivate", id)).toBe(1);
    expect(await auditCount(T1, "bin", "activate", id)).toBe(1);
  });

  it("race: two identical deactivations published at once -> one applies, the other is dead-lettered", async () => {
    const id = await createBin("FP-BIN-2");
    const before = mq().dlq.length;
    const pub = () => queue.publish(COMMANDS.binSetStatus, {
      messageId: randomUUID(), type: COMMANDS.binSetStatus, tenantId: T1, actorId: CHECKER,
      correlationId: "corr-fp-bin", schemaVersion: "1.0", payload: { id, tenantId: T1, isActive: false },
    });
    await Promise.all([pub(), pub()]);
    await drain();
    const b = await binRow(id);
    expect(b.isActive).toBe(false);
    expect(b.version).toBe(2);
    expect(mq().dlq.slice(before).filter((d) => d.error.includes("BIN_STATE"))).toHaveLength(1);
  });

  it("404 for an unknown bin, 403 for a role below manager, 404 across tenants", async () => {
    const unknown = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${randomUUID()}/status`, headers: mgr(T1, CHECKER), payload: { isActive: false } });
    expect(unknown.statusCode).toBe(404);
    const id = await createBin("FP-BIN-3");
    const clerk = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${id}/status`, headers: hdr(T1, MAKER, ["store_keeper"]), payload: { isActive: false } });
    expect(clerk.statusCode).toBe(403);
    const other = await app.inject({ method: "PATCH", url: `/v1/inventory/bins/${id}/status`, headers: mgr(T2, ACTOR_T2), payload: { isActive: false } });
    expect(other.statusCode).toBe(404);
    expect((await binRow(id)).isActive).toBe(true);
  });
});

describe("GAP-INVENTORY-SUBSTITUTES-04: bulk substitutes read", () => {
  it("is tenant-scoped, ordered, paged and role-gated", async () => {
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.insert(itemSubstitutes).values([
        { id: randomUUID(), tenantId: T1, itemId: ITEM1, substituteId: ITEM2, priority: 2, conversionFactor: "1", createdBy: MAKER, updatedBy: MAKER },
        { id: randomUUID(), tenantId: T1, itemId: ITEM2, substituteId: ITEM1, priority: 1, conversionFactor: "1", createdBy: MAKER, updatedBy: MAKER },
      ]);
    }));
    await runWithTenant(T2, () => db.transaction(async (tx) => {
      await tx.insert(itemSubstitutes).values({ id: randomUUID(), tenantId: T2, itemId: ITEM_T2, substituteId: ITEM_T2, priority: 1, conversionFactor: "1", createdBy: ACTOR_T2, updatedBy: ACTOR_T2 });
    }));
    const res = await app.inject({ method: "GET", url: "/v1/inventory/substitutes?limit=200", headers: mgr(T1, MAKER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ tenantId: string; itemId: string }>; pagination: { hasMore: boolean } };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r) => r.tenantId === T1)).toBe(true);
    expect(body.pagination.hasMore).toBe(false);

    const page = await app.inject({ method: "GET", url: "/v1/inventory/substitutes?limit=1", headers: mgr(T1, MAKER) });
    expect(page.json().data).toHaveLength(1);
    expect(page.json().pagination.hasMore).toBe(true);
    const page2 = await app.inject({ method: "GET", url: "/v1/inventory/substitutes?limit=1&offset=1", headers: mgr(T1, MAKER) });
    expect(page2.json().data[0].id).not.toBe(page.json().data[0].id);

    const denied = await app.inject({ method: "GET", url: "/v1/inventory/substitutes", headers: hdr(T1, MAKER, ["citizen"]) });
    expect(denied.statusCode).toBe(403);
    const tooMany = await app.inject({ method: "GET", url: "/v1/inventory/substitutes?limit=5000", headers: mgr(T1, MAKER) });
    expect(tooMany.statusCode).toBe(400);
  });
});

describe("names from identity-service (GOODS-RETURNS-DETAIL-05 / CYCLE-COUNTS-DETAIL-03)", () => {
  function stubIdentity(names: Record<string, string> | "down") {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (!String(url).includes("/identity/internal/user-summaries")) throw new Error(`unexpected fetch ${String(url)}`);
      if (names === "down") throw new Error("identity down");
      return new Response(JSON.stringify(Object.entries(names).map(([id, name]) => ({ id, name }))), { status: 200 });
    }));
  }

  it("goods-return detail carries createdByName / qcInspectedByName", async () => {
    const id = await createReturn();
    await app.inject({ method: "PATCH", url: `/v1/inventory/goods-returns/${id}/inspect`, headers: mgr(T1, CHECKER), payload: { qcStatus: "passed", disposition: "restock" } });
    await drain();
    stubIdentity({ [MAKER]: "Asha Rao", [CHECKER]: "Vikram Sethi" });
    const res = await app.inject({ method: "GET", url: `/v1/inventory/goods-returns/${id}`, headers: mgr(T1, MAKER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ createdByName: "Asha Rao", qcInspectedByName: "Vikram Sethi", qcStatus: "passed" });
  });

  it("an unreachable identity-service never breaks the read: names are null", async () => {
    const id = await createReturn();
    stubIdentity("down");
    const res = await app.inject({ method: "GET", url: `/v1/inventory/goods-returns/${id}`, headers: mgr(T1, MAKER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.createdByName).toBeNull();
    expect(res.json().data.qcInspectedByName).toBeNull();
  });
});

describe("GAP-INVENTORY-RECEIPTS-03 / CYCLE-COUNTS-DETAIL-05: GRN references and movement detail", () => {
  it("a receipt posted from an accepted GRN carries GRN no / PO / supplier on its ledger rows and movement detail", async () => {
    const grnId = randomUUID();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes(`/v1/procurement/grns/${grnId}`)) {
        return new Response(JSON.stringify({ id: grnId, grnNo: "GRN-2026-0042", poRef: "PO-2026-0007", vendorId: VENDOR, status: "accepted" }), { status: 200 });
      }
      if (u.includes("/identity/internal/user-summaries")) {
        return new Response(JSON.stringify([{ id: MAKER, name: "Asha Rao" }]), { status: 200 });
      }
      throw new Error(`unexpected fetch ${u}`);
    }));
    await queue.publish(CONSUMED.grnAccepted, {
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: T1, actorId: MAKER,
      correlationId: "corr-fp-grn", schemaVersion: "1.0",
      payload: { grnId, toStoreId: STORE1, postingDate: "2026-02-01", items: [{ itemId: ITEM1, acceptedQty: 5, rateMinor: 1200, currency: "INR" }] },
    });
    await drain();

    const ledger = await app.inject({ method: "GET", url: "/v1/inventory/ledger?movementType=receipt", headers: mgr(T1, MAKER) });
    expect(ledger.statusCode).toBe(200);
    const rows = ledger.json().data as Array<Record<string, unknown>>;
    const mine = rows.find((r) => r.refNo === grnId);
    expect(mine).toMatchObject({ refDoc: "GRN", grnNo: "GRN-2026-0042", poRef: "PO-2026-0007", supplierId: VENDOR, qtyIn: 5 });

    const detail = await app.inject({ method: "GET", url: `/v1/inventory/movements/${mine!.movementId as string}`, headers: mgr(T1, MAKER) });
    expect(detail.statusCode).toBe(200);
    const d = detail.json().data;
    expect(d).toMatchObject({ movementType: "receipt", grnNo: "GRN-2026-0042", createdByName: "Asha Rao" });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ itemId: ITEM1, qty: 5, rateMinor: "1200", amountMinor: "6000" });

    // another tenant can neither see the ledger row nor the movement
    const other = await app.inject({ method: "GET", url: `/v1/inventory/movements/${mine!.movementId as string}`, headers: mgr(T2, ACTOR_T2) });
    expect(other.statusCode).toBe(404);
  });

  it("procurement-service down: the receipt still posts, just without references", async () => {
    const grnId = randomUUID();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("procurement down"); }));
    await queue.publish(CONSUMED.grnAccepted, {
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: T1, actorId: MAKER,
      correlationId: "corr-fp-grn2", schemaVersion: "1.0",
      payload: { grnId, toStoreId: STORE1, postingDate: "2026-02-02", items: [{ itemId: ITEM2, acceptedQty: 3, rateMinor: 500, currency: "INR" }] },
    });
    await drain();
    const ledger = await app.inject({ method: "GET", url: "/v1/inventory/ledger?movementType=receipt", headers: mgr(T1, MAKER) });
    const mine = (ledger.json().data as Array<Record<string, unknown>>).find((r) => r.refNo === grnId);
    expect(mine).toBeDefined();
    expect(mine!.grnNo).toBeNull();
    expect(mine!.poRef).toBeNull();
    expect(mine!.supplierId).toBeNull();
  });
});

describe("cycle-count detail names (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-03)", () => {
  it("returns approvedByName / rejectedByName; null when identity-service cannot name them", async () => {
    const id = randomUUID();
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.insert(cycleCounts).values({
        id, tenantId: T1, itemId: ITEM1, warehouseId: STORE1, systemQty: 10, physicalQty: 7, variance: -3, absVariance: 3,
        autoAdjustThreshold: 1, reasonCode: "COUNT", status: "approved", approvedBy: CHECKER, approvedAt: new Date(),
        createdBy: MAKER, updatedBy: CHECKER,
      });
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: CHECKER, name: "Vikram Sethi" }]), { status: 200 })));
    const res = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: mgr(T1, CHECKER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ approvedByName: "Vikram Sethi", rejectedByName: null, createdByName: null });

    clearIdentityNameCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("identity down"); }));
    const degraded = await app.inject({ method: "GET", url: `/v1/inventory/cycle-counts/${id}`, headers: mgr(T1, CHECKER) });
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json().data.approvedByName).toBeNull();
  });
});
