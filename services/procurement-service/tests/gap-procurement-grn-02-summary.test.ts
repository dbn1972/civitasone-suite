/**
 * GAP-PROCUREMENT-GRN-02 — the GRN register reports TRUE totals and status
 * counts, and its search reaches GRNs beyond the first page.
 *
 * Seeds more GRNs than one list page and asserts, through the real Fastify app
 * and Postgres test DB:
 *  - GET /grns/summary counts every GRN (not the page): total + per-group counts
 *  - GET /grns?q= finds a GRN that sits outside the first page, by GRN no and by
 *    vendor name, and ?vendorId= / ?status= narrow server-side
 *  - another tenant's GRNs never leak into the counts or the list
 *  - the reader role gate applies to /summary
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns } from "../src/modules/grn/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const VENDOR_A = randomUUID();
const VENDOR_B = randomUUID();

function hdr(roles: string[], tenant = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenant, roles, sid: `sess-${randomUUID()}` }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenant };
}

let app: FastifyInstance;

async function seedGrn(tenantId: string, vendorId: string, grnNo: string, status: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction((tx) => tx.insert(procurementGrns).values({
    tenantId, grnNo, vendorId, poRef: `procurement_po:${randomUUID()}`, status,
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

beforeAll(async () => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!"; // gitleaks:allow
  process.env.PII_KEY_ID = "k1";
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [id, name] of [[VENDOR_A, "Alpha Stationers"], [VENDOR_B, "Zenith Hardware"]] as const) {
      await tx.insert(procurementVendors).values({ id, tenantId: TENANT, name, createdBy: ACTOR, updatedBy: ACTOR });
    }
  }));
  // 12 accepted + 5 draft + 2 under_inspection + 2 rejected + 1 partial = 22 for the tenant.
  // (`partial` renders as draft in list rows, so it counts as awaiting.)
  for (let i = 0; i < 12; i++) await seedGrn(TENANT, VENDOR_A, `GRN-AC-${String(i).padStart(3, "0")}`, "accepted");
  for (let i = 0; i < 5; i++) await seedGrn(TENANT, VENDOR_A, `GRN-DR-${i}`, "draft");
  for (let i = 0; i < 2; i++) await seedGrn(TENANT, VENDOR_A, `GRN-UI-${i}`, "under_inspection");
  for (let i = 0; i < 2; i++) await seedGrn(TENANT, VENDOR_A, `GRN-RJ-${i}`, "rejected");
  await seedGrn(TENANT, VENDOR_B, "GRN-ZZ-LAST", "partial");
  await seedGrn(OTHER_TENANT, randomUUID(), "GRN-OTHER-001", "accepted");
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

const READER = ["procurement_officer"];

describe("GAP-PROCUREMENT-GRN-02 server-side summary and search", () => {
  it("summary counts every GRN of the tenant, not one page", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns/summary", headers: hdr(READER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ total: 22, accepted: 12, awaitingInspection: 8, rejected: 2 });
  });

  it("the list is paged server-side and a page is smaller than the summary total", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns?limit=10&offset=0", headers: hdr(READER) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(10);
    const page3 = await app.inject({ method: "GET", url: "/v1/procurement/grns?limit=10&offset=20", headers: hdr(READER) });
    expect(page3.json()).toHaveLength(2);
  });

  it("search finds a GRN outside the first page, by GRN number and by vendor name", async () => {
    const byNo = await app.inject({ method: "GET", url: "/v1/procurement/grns?limit=5&q=GRN-ZZ-LAST", headers: hdr(READER) });
    expect(byNo.json().map((g: { grnNo: string }) => g.grnNo)).toEqual(["GRN-ZZ-LAST"]);
    const byVendor = await app.inject({ method: "GET", url: "/v1/procurement/grns?limit=5&q=zenith", headers: hdr(READER) });
    expect(byVendor.json().map((g: { grnNo: string }) => g.grnNo)).toEqual(["GRN-ZZ-LAST"]);
    const summary = await app.inject({ method: "GET", url: "/v1/procurement/grns/summary?q=zenith", headers: hdr(READER) });
    expect(summary.json().data).toEqual({ total: 1, accepted: 0, awaitingInspection: 1, rejected: 0 });
  });

  it("a typed % matches literally, not as a wildcard", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns?q=%25", headers: hdr(READER) });
    expect(res.json()).toHaveLength(0);
  });

  it("vendorId and status filters narrow server-side", async () => {
    const byVendor = await app.inject({ method: "GET", url: `/v1/procurement/grns/summary?vendorId=${VENDOR_B}`, headers: hdr(READER) });
    expect(byVendor.json().data.total).toBe(1);
    const byStatus = await app.inject({ method: "GET", url: "/v1/procurement/grns?status=draft&limit=50", headers: hdr(READER) });
    expect(byStatus.json()).toHaveLength(5);
    const bad = await app.inject({ method: "GET", url: "/v1/procurement/grns?status=bogus", headers: hdr(READER) });
    expect(bad.statusCode).toBe(400);
  });

  it("never leaks another tenant's GRNs", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns?q=GRN-OTHER", headers: hdr(READER) });
    expect(res.json()).toHaveLength(0);
    const other = await app.inject({ method: "GET", url: "/v1/procurement/grns/summary", headers: hdr(READER, OTHER_TENANT) });
    expect(other.json().data.total).toBe(1);
  });

  it("summary requires a reader role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns/summary", headers: hdr(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});
