/**
 * PR #2463 review: PO and GRN PDF routes against the real DB (disposable) and Chromium. The GRN
 * prints the PO NUMBER (never the internal procurement_po:<uuid> ref or the PO line id).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { closePdfRenderer } from "@civitasone/render";
import { pdfFlatText } from "@civitasone/render/testing";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "9c900000-1111-4000-8000-0000000d0c61";
const OTHER_T = "9c900000-1111-4000-8000-0000000d0c62";
const ACTOR = "9c900000-2222-4000-8000-0000000d0c61";
const VENDOR = "9c900000-3333-4000-8000-0000000d0c61";
const PO = "9c900000-4444-4000-8000-0000000d0c61";
const PO_LINE = "9c900000-5555-4000-8000-0000000d0c61";
const GRN = "9c900000-6666-4000-8000-0000000d0c61";
const tok = (roles: string[], tid = T) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-grnpdf" }, SECRET, 3600)}` });
const tx = <R>(fn: (t: typeof db) => Promise<R>) => runWithTenant(T, () => db.transaction((t) => fn(t as unknown as typeof db)));

async function wipe() {
  await tx(async (t) => {
    await t.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, T));
    await t.delete(procurementGrns).where(eq(procurementGrns.tenantId, T));
    await t.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, T));
    await t.delete(procurementPos).where(eq(procurementPos.tenantId, T));
    await t.delete(procurementVendors).where(eq(procurementVendors.tenantId, T));
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  app = await buildApp();
  await wipe();
  await tx(async (t) => {
    await t.insert(procurementVendors).values({ id: VENDOR, tenantId: T, name: "Acme Supplies", gstin: "07BBBBB1111B1Z5", createdBy: ACTOR, updatedBy: ACTOR });
    await t.insert(procurementPos).values({ id: PO, tenantId: T, poNo: "PO/2026/0935", vendorId: VENDOR, indentRef: "IND/2026/0012", totalMinor: 600_200n, status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
    await t.insert(procurementPoItems).values({ id: PO_LINE, poId: PO, tenantId: T, itemCode: "IT-001", description: "Desktop computer", quantity: 4, unitPriceMinor: 150_050n, gstRateBp: 1800, hsnSac: "84713010", createdBy: ACTOR, updatedBy: ACTOR });
    await t.insert(procurementGrns).values({ id: GRN, tenantId: T, grnNo: "GRN/2026/0922", poRef: `procurement_po:${PO}`, vendorId: VENDOR, receivedDate: "2026-11-04", status: "draft", createdBy: ACTOR, updatedBy: ACTOR });
    await t.insert(procurementGrnItems).values({ id: randomUUID(), grnId: GRN, tenantId: T, poItemRef: PO_LINE, itemCode: "IT-001", orderedQty: 4, receivedQty: 4, acceptedQty: 0, createdBy: ACTOR, updatedBy: ACTOR });
  });
});
afterAll(async () => { vi.unstubAllGlobals(); await wipe(); await app.close(); await closePdfRenderer(); await sqlClient.end(); });

describe("GET /v1/procurement/pos/:id/pdf", () => {
  it("200 application/pdf with the line from po_items (never \"No line items\") and the GST split", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/procurement/pos/${PO}/pdf`, headers: tok(["procurement_officer"]) });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    const text = await pdfFlatText(r.rawPayload);
    expect(text).not.toMatch(/No line items/i);
    expect(text).toContain("Desktop computer (IT-001)");
    expect(text).toContain("84713010");
    expect(text).toContain("6,002.00");
  }, 60_000);
  it("404 for another tenant, 403 for a non-procurement role", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/procurement/pos/${PO}/pdf`, headers: tok(["procurement_officer"], OTHER_T) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/procurement/pos/${PO}/pdf`, headers: tok(["employee"]) })).statusCode).toBe(403);
  });
});

describe("GET /v1/procurement/grns/:id/pdf", () => {
  it("200 application/pdf: PO number, item name, no internal ids", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/procurement/grns/${GRN}/pdf`, headers: tok(["store_officer"]) });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    const text = await pdfFlatText(r.rawPayload);
    expect(text).toContain("No. GRN/2026/0922");
    expect(text).toContain("PO No. PO/2026/0935");
    expect(text).toContain("Desktop computer (IT-001)");
    expect(text).not.toContain(PO);
    expect(text).not.toContain(PO_LINE);
    expect(text).not.toContain("procurement_po:");
  }, 60_000);
  it("404 for an unknown GRN or another tenant; 403 for a role outside the GRN readers; 400 for a bad id", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/procurement/grns/${randomUUID()}/pdf`, headers: tok(["store_officer"]) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/procurement/grns/${GRN}/pdf`, headers: tok(["store_officer"], OTHER_T) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/procurement/grns/${GRN}/pdf`, headers: tok(["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/procurement/grns/not-a-uuid/pdf", headers: tok(["store_officer"]) })).statusCode).toBe(400);
  });
});
