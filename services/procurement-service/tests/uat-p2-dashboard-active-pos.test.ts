/**
 * UAT Phase 2 follow-up: the dashboard "Active POs" counted `approved` only,
 * missing dispatched and GeM-placed POs that are still open obligations. It now
 * counts approved + dispatched + gem_placed (+ partial_grn); closed (fulfilled),
 * cancelled, draft and pending POs are not active.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPos } from "../src/modules/po/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9c900000-1111-4000-8000-0000000000a6";
const ACTOR  = "9c900000-2222-4000-8000-0000000000a6";
const VENDOR = "9c900000-3333-4000-8000-0000000000a6";

let app: FastifyInstance;
const wipe = () => runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT))));

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [i, status] of ["approved", "dispatched", "gem_placed", "closed", "cancelled", "draft", "pending"].entries()) {
      await tx.insert(procurementPos).values({
        id: randomUUID(), tenantId: TENANT, poNo: `PO-ACT-${i}`, vendorId: VENDOR, indentRef: "procurement_indent:seed",
        status, totalMinor: 10000n, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  }));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /v1/procurement/dashboard — activePOs", () => {
  it("counts approved + dispatched + GeM-placed, not closed / cancelled / draft / pending", async () => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s-act" }, SECRET, 3600);
    const res = await app.inject({ method: "GET", url: "/v1/procurement/dashboard", headers: { authorization: `Bearer ${token}`, "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { activePOs?: number; data?: { activePOs?: number } };
    expect(body.activePOs ?? body.data?.activePOs).toBe(3);
  });
});
