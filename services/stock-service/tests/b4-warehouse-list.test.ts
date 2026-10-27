/**
 * GAP-STOCK-LEDGER-NEW-01 (UAT B4): GET /v1/stock/warehouses feeds the entry form's From/To
 * pickers so inter-warehouse transfers can be expressed; POST /v1/stock/entries rejects a
 * transfer that does not name two different warehouses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { stockWarehouses } from "../src/modules/warehouse/schema.js";
import { createEntryBody } from "../src/modules/entry/validators.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const WH_ACTIVE = randomUUID();
const WH_INACTIVE = randomUUID();
const WH_OTHER_TENANT = randomUUID();
const ITEM = randomUUID();

const bearer = (roles: string[], tid = TENANT_A) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-b4wh" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(stockWarehouses).where(eq(stockWarehouses.tenantId, t))));
  }
}

beforeAll(async () => {
  app = await buildApp();
  await clean();
  const base = { createdBy: ACTOR, updatedBy: ACTOR };
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(stockWarehouses).values([
    { id: WH_ACTIVE, tenantId: TENANT_A, name: "Central Store", code: "CS-01", isActive: true, ...base },
    { id: WH_INACTIVE, tenantId: TENANT_A, name: "Closed Depot", code: "CD-09", isActive: false, ...base },
  ])));
  await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.insert(stockWarehouses).values(
    { id: WH_OTHER_TENANT, tenantId: TENANT_B, name: "Other Tenant Store", code: "OT-01", isActive: true, ...base },
  )));
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GET /v1/stock/warehouses", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/warehouses" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside the stock reader set", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/warehouses", headers: bearer(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("lists only the caller tenant active warehouses by default", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/warehouses", headers: bearer(["stock_manager"]) });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toEqual([WH_ACTIVE]);
    expect(res.json().data[0]).toMatchObject({ name: "Central Store", code: "CS-01", isActive: true });
  });

  it("activeOnly=false includes inactive ones; never another tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/warehouses?activeOnly=false", headers: bearer(["audit_officer"]) });
    const ids = (res.json().data as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toContain(WH_INACTIVE);
    expect(ids).not.toContain(WH_OTHER_TENANT);
  });

  it("q filters by name or code, treating % and _ literally", async () => {
    const hit = await app.inject({ method: "GET", url: "/v1/stock/warehouses?q=cs-0", headers: bearer(["stock_manager"]) });
    expect((hit.json().data as unknown[]).length).toBe(1);
    const wild = await app.inject({ method: "GET", url: "/v1/stock/warehouses?q=%25", headers: bearer(["stock_manager"]) });
    expect((wild.json().data as unknown[]).length).toBe(0);
  });
});

describe("transfer entries need a from/to pair", () => {
  const base = { entryType: "transfer", postingDate: "2026-10-01", items: [{ itemId: ITEM, qty: 1 }] };
  it("rejects a transfer with only one warehouse", () => {
    expect(createEntryBody.safeParse({ ...base, toWarehouseId: WH_ACTIVE }).success).toBe(false);
    expect(createEntryBody.safeParse({ ...base, fromWarehouseId: WH_ACTIVE }).success).toBe(false);
  });
  it("rejects from === to", () => {
    expect(createEntryBody.safeParse({ ...base, fromWarehouseId: WH_ACTIVE, toWarehouseId: WH_ACTIVE }).success).toBe(false);
  });
  it("accepts two different warehouses; other entry types are unaffected", () => {
    expect(createEntryBody.safeParse({ ...base, fromWarehouseId: WH_ACTIVE, toWarehouseId: WH_INACTIVE }).success).toBe(true);
    expect(createEntryBody.safeParse({ ...base, entryType: "receipt", toWarehouseId: WH_ACTIVE }).success).toBe(true);
  });
  it("POST /v1/stock/entries answers 400 for a one-sided transfer", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries", headers: bearer(["stock_manager"]),
      payload: { ...base, toWarehouseId: WH_ACTIVE },
    });
    expect(res.statusCode).toBe(400);
  });
});
