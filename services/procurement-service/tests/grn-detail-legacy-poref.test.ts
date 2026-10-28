/**
 * Regression — main CI run 40600197919 (Live Stack Verification):
 * GET /v1/procurement/grns/:id returned HTTP 500 for a GRN whose po_ref is a
 * bare human PO number (the seeded/legacy `PO/2024/001`) rather than the opaque
 * `procurement_po:<uuid>` composite. poIdFromRef() passed that string to
 * findPoById(), and Postgres rejected it with `invalid input syntax for type
 * uuid`. A non-uuid ref must resolve to "no linked PO", never a 500.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns } from "../src/modules/grn/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9e000000-1111-4000-8000-0000000000a1";
const ACTOR = "9e000000-2222-4000-8000-0000000000a1";
const VENDOR = "9e000000-4444-4000-8000-0000000000a1";
const GRN_LEGACY = randomUUID();
const GRN_BLANK = randomUUID();

const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "sess-grn-legacy-poref" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
});

let app: FastifyInstance;
async function wipe() {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT))));
}

beforeAll(async () => {
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementGrns).values([
      { id: GRN_LEGACY, tenantId: TENANT, grnNo: "GRN/2024/002", poRef: "PO/2024/001", vendorId: VENDOR, status: "draft", createdBy: ACTOR, updatedBy: ACTOR },
      { id: GRN_BLANK, tenantId: TENANT, grnNo: "GRN/2024/003", poRef: "procurement_po:undefined", vendorId: VENDOR, status: "draft", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
  app = await buildApp();
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GRN detail with a non-uuid po_ref", () => {
  it("returns 200 (not 500) for a legacy human-number poRef, with no resolved PO link", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/procurement/grns/${GRN_LEGACY}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.poRef).toBe("PO/2024/001");
    expect(body.poId).toBeUndefined();
    expect(body.poNo).toBeUndefined();
  });

  it("returns 200 for a placeholder `procurement_po:undefined` ref", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/procurement/grns/${GRN_BLANK}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().poId).toBeUndefined();
  });
});
