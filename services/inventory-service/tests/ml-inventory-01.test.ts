/**
 * ml-inventory-01 gap batch: QC verdict/disposition matrix (GOODS-RETURNS-DETAIL-01)
 * and the ledger movementType filter (ISSUES-02/-04).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { qcInspectionBody, qcInspectionPayload } from "../src/modules/items/validators.js";
import { ledgerQueryParams } from "../src/modules/movements/validators.js";

const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const TENANT = "11111111-aaaa-4000-8000-0000000000a1";
const GR_ID = "44444444-aaaa-4000-8000-0000000000a1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function auth(roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600)}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

describe("qcInspectionBody verdict/disposition matrix (GAP-INVENTORY-GOODS-RETURNS-DETAIL-01)", () => {
  it("rejects a failed verdict with restock", () => {
    expect(() => qcInspectionBody.parse({ qcStatus: "failed", disposition: "restock" })).toThrow();
  });
  it("rejects a passed verdict with scrap", () => {
    expect(() => qcInspectionBody.parse({ qcStatus: "passed", disposition: "scrap" })).toThrow();
  });
  it("accepts the legitimate combinations", () => {
    expect(qcInspectionBody.parse({ qcStatus: "passed", disposition: "restock" }).disposition).toBe("restock");
    expect(qcInspectionBody.parse({ qcStatus: "failed", disposition: "scrap" }).disposition).toBe("scrap");
    expect(qcInspectionBody.parse({ qcStatus: "failed", disposition: "quarantine" }).disposition).toBe("quarantine");
    expect(qcInspectionBody.parse({ qcStatus: "conditional", disposition: "restock" }).qcStatus).toBe("conditional");
  });
  it("the queue payload schema stays extendable (id/tenant/inspector)", () => {
    const p = qcInspectionPayload.parse({
      id: GR_ID, tenantId: TENANT, inspectedBy: ACTOR, qcStatus: "passed", disposition: "restock",
    });
    expect(p.inspectedBy).toBe(ACTOR);
  });
  it("PATCH /goods-returns/:id/inspect -> 400 for failed+restock (never reaches the queue)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${GR_ID}/inspect`,
      headers: auth(["inventory_manager"]),
      payload: { qcStatus: "failed", disposition: "restock" },
    });
    expect(res.statusCode).toBe(400);
  });
  it("PATCH /goods-returns/:id/inspect -> 404 for an unknown return, not a silently dropped 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/inventory/goods-returns/${GR_ID}/inspect`,
      headers: auth(["inventory_manager"]),
      payload: { qcStatus: "failed", disposition: "scrap", qcNotes: "water damaged" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("ledger movementType filter (GAP-INVENTORY-ISSUES-02/-04)", () => {
  it("accepts each real movement type", () => {
    for (const t of ["receipt", "issue", "transfer", "adjustment"]) {
      expect(ledgerQueryParams.parse({ movementType: t }).movementType).toBe(t);
    }
  });
  it("rejects an unknown movement type", () => {
    expect(() => ledgerQueryParams.parse({ movementType: "bogus" })).toThrow();
  });
  it("GET /ledger?movementType=bogus -> 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/inventory/ledger?movementType=bogus", headers: auth(["inventory_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
  it("GET /ledger?movementType=issue -> 200 for a reader role, 403 without one", async () => {
    const ok = await app.inject({
      method: "GET", url: "/v1/inventory/ledger?movementType=issue&limit=500", headers: auth(["store_keeper"]),
    });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({
      method: "GET", url: "/v1/inventory/ledger?movementType=issue", headers: auth(["citizen"]),
    });
    expect(denied.statusCode).toBe(403);
  });
});
