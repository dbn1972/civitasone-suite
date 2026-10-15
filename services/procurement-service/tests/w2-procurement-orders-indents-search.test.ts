/**
 * Wave 2 procurement part 2 (vendors / RFQ / PO form):
 *  VENDORS-DETAIL-04 GET /orders?vendorId= filters to one vendor, tenant-scoped.
 *  ORDERS-NEW-03     GET /indents?q= searches approved indents past the first page.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "c2c2c2c2-1111-4000-8000-000000000001";
const OTHER = "c2c2c2c2-1111-4000-8000-000000000002";
const MAKER = "c2c2c2c2-2222-4000-8000-000000000001";
const CHECKER = "c2c2c2c2-2222-4000-8000-000000000002";
const VENDOR_A = "c2c2c2c2-3333-4000-8000-00000000000a";
const VENDOR_B = "c2c2c2c2-3333-4000-8000-00000000000b";

let app: FastifyInstance;
const auth = (tid = TENANT, roles = ["procurement_officer"]) => ({
  authorization: `Bearer ${signToken({ sub: CHECKER, tid, roles, sid: "s-w2a" }, SECRET)}`,
  "content-type": "application/json",
});

const indentId = randomUUID();
const poA = randomUUID();
const poB = randomUUID();

async function wipe() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(procurementPos).where(eq(procurementPos.tenantId, t));
      await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, t));
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values([
      { id: VENDOR_A, tenantId: TENANT, name: "Vendor A", createdBy: MAKER, updatedBy: MAKER },
      { id: VENDOR_B, tenantId: TENANT, name: "Vendor B", createdBy: MAKER, updatedBy: MAKER },
    ]);
    await tx.insert(procurementIndents).values({
      id: indentId, tenantId: TENANT, indentNo: "IND-W2A-1", department: "Stores", purpose: "w2",
      totalMinor: 12345600n, currency: "INR", status: "pending", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(procurementPos).values([
      { id: poA, tenantId: TENANT, poNo: "PO-W2A-1", vendorId: VENDOR_A, indentRef: "IND-W2A-1", status: "draft", totalMinor: 500000n, createdBy: MAKER, updatedBy: MAKER },
      { id: poB, tenantId: TENANT, poNo: "PO-W2A-2", vendorId: VENDOR_B, indentRef: "IND-W2A-1", status: "draft", totalMinor: 700000n, createdBy: MAKER, updatedBy: MAKER },
    ]);
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("VENDORS-DETAIL-04: orders filtered by vendor", () => {
  it("returns only that vendor's POs", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/procurement/orders?vendorId=${VENDOR_A}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: { poNo: string }) => p.poNo)).toEqual(["PO-W2A-1"]);
    const all = await app.inject({ method: "GET", url: "/v1/procurement/orders", headers: auth() });
    expect(all.json().data).toHaveLength(2);
  });
  it("rejects a malformed vendorId and does not leak across tenants", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/procurement/orders?vendorId=zzz", headers: auth() })).statusCode).toBe(400);
    const other = await app.inject({ method: "GET", url: `/v1/procurement/orders?vendorId=${VENDOR_A}`, headers: auth(OTHER) });
    expect(other.json().data).toEqual([]);
  });
});

describe("ORDERS-NEW-03: indent picker search", () => {
  it("GET /indents?q= finds an indent by number past any page, combined with the status filter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    const hit = await app.inject({ method: "GET", url: "/v1/procurement/indents?status=pending&q=W2A", headers: auth() });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data ?? hit.json()).toHaveLength(1);
    const body = hit.json();
    const rows = Array.isArray(body) ? body : body.data;
    expect(rows[0].indentNo).toBe("IND-W2A-1");
    const miss = await app.inject({ method: "GET", url: "/v1/procurement/indents?status=approved&q=W2A", headers: auth() });
    const missRows = Array.isArray(miss.json()) ? miss.json() : miss.json().data;
    expect(missRows).toEqual([]);
    const none = await app.inject({ method: "GET", url: "/v1/procurement/indents?q=NO-SUCH-INDENT", headers: auth() });
    const noneRows = Array.isArray(none.json()) ? none.json() : none.json().data;
    expect(noneRows).toEqual([]);
  });
});
