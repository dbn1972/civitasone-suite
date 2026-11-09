/**
 * UAT bundle 23: POST /v1/inventory/grn-precheck - the read-only check procurement calls when a GRN is accepted.
 * It must classify SKUs exactly as the procurement.grn.accepted consumer does (active items of the tenant only;
 * zero matches = unknown, more than one = ambiguous) and the receiving store (active store of the tenant).
 * Real Postgres as the non-superuser inventory_svc role (RLS in force); tenant isolation asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { items } from "../src/modules/items/schema.js";
import { stores } from "../src/modules/stores/schema.js";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const STORE = randomUUID();
const CLOSED_STORE = randomUUID();
const OTHER_STORE = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const hdr = (tid = TENANT, roles = ["inventory_user"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-b23-inv" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(items).values([
      { id: randomUUID(), tenantId: TENANT, name: "A4 paper 75 GSM (ream)", sku: "STN-A4-75GSM", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenantId: TENANT, name: "Toner 12A", sku: "STN-TONER-12A", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenantId: TENANT, name: "Toner 12A (duplicate master)", sku: "STN-TONER-12A", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenantId: TENANT, name: "Retired stapler", sku: "STN-STAPLER-OLD", isActive: false, reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(stores).values([
      { id: STORE, tenantId: TENANT, name: "Central Store", code: "CS-01", createdBy: ACTOR, updatedBy: ACTOR },
      { id: CLOSED_STORE, tenantId: TENANT, name: "Old Godown", code: "OG-01", isActive: false, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
  await runWithTenant(OTHER, () => db.transaction(async (tx) => {
    await tx.insert(items).values({ id: randomUUID(), tenantId: OTHER, name: "Other tenant item", sku: "OTHER-ONLY-SKU", reorderLevel: 0, reorderQty: 0, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(stores).values({ id: OTHER_STORE, tenantId: OTHER, name: "Other store", code: "OS-01", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(stores).where(eq(stores.tenantId, t));
      await tx.delete(items).where(eq(items.tenantId, t));
    }));
  }
  await sqlClient.end();
});

async function precheck(payload: unknown, headers = hdr()) {
  const app = await buildApp();
  try {
    return await app.inject({ method: "POST", url: "/v1/inventory/grn-precheck", headers, payload: payload as object });
  } finally { await app.close(); }
}

describe("POST /v1/inventory/grn-precheck", () => {
  it("classifies unknown, inactive, ambiguous and good SKUs like the consumer does", async () => {
    const res = await precheck({ skus: ["STN-A4-75GSM", "NO-SUCH-SKU", "STN-TONER-12A", "STN-STAPLER-OLD"], storeId: STORE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unknownSkus: ["NO-SUCH-SKU", "STN-STAPLER-OLD"], ambiguousSkus: ["STN-TONER-12A"], storeKnown: true });
  });

  it("another tenant's item or store does not count", async () => {
    const res = await precheck({ skus: ["OTHER-ONLY-SKU"], storeId: OTHER_STORE });
    expect(res.json()).toEqual({ unknownSkus: ["OTHER-ONLY-SKU"], ambiguousSkus: [], storeKnown: false });
  });

  it("an inactive store is unknown; no storeId => storeKnown null", async () => {
    expect((await precheck({ skus: ["STN-A4-75GSM"], storeId: CLOSED_STORE })).json().storeKnown).toBe(false);
    expect((await precheck({ skus: ["STN-A4-75GSM"] })).json()).toEqual({ unknownSkus: [], ambiguousSkus: [], storeKnown: null });
  });

  it("validates the body and the caller's role", async () => {
    expect((await precheck({ skus: "x" })).statusCode).toBe(400);
    expect((await precheck({ skus: ["A"] }, hdr(TENANT, ["citizen"]))).statusCode).toBe(403);
  });
});
