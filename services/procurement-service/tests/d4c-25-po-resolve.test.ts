/**
 * D4c #25 (GAP-PROCUREMENT-CONTRACTS-NEW-06): procurement-service resolves a PO
 * reference (uuid, procurement_po:<uuid> or the PO number) for contract-service,
 * tenant-scoped, so a contract can only quote a PO that really exists.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPos } from "../src/modules/po/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const PO_ID = randomUUID();
const PO_NO = `PO/D4C25/${PO_ID.slice(0, 6)}`;
const FOREIGN_NO = `PO/D4C25F/${PO_ID.slice(0, 6)}`;
let app: FastifyInstance;
const hdr = (tenant = TENANT, roles = ["procurement_officer"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET, 3600)}`, "x-tenant-id": tenant });
const resolve = (ref: string, tenant = TENANT, roles?: string[]) => app.inject({ method: "GET", url: `/v1/procurement/pos/resolve?ref=${encodeURIComponent(ref)}`, headers: hdr(tenant, roles) });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementPos).values({ id: PO_ID, tenantId: TENANT, poNo: PO_NO, vendorId: randomUUID(), indentRef: "x", createdBy: ACTOR, updatedBy: ACTOR })));
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(procurementPos).values({ id: randomUUID(), tenantId: OTHER, poNo: FOREIGN_NO, vendorId: randomUUID(), indentRef: "x", createdBy: ACTOR, updatedBy: ACTOR })));
});
afterAll(async () => {
  for (const t of [TENANT, OTHER]) await runWithTenant(t, () => db.transaction((tx) => tx.delete(procurementPos).where(eq(procurementPos.tenantId, t))));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/procurement/pos/resolve", () => {
  it("resolves by PO number, uuid and procurement_po:<uuid>", async () => {
    for (const ref of [PO_NO, PO_ID, `procurement_po:${PO_ID}`, `  ${PO_NO}  `]) {
      const res = await resolve(ref);
      expect(res.statusCode, ref).toBe(200);
      expect(res.json().data).toMatchObject({ id: PO_ID, poNo: PO_NO });
    }
  });
  it("404s an unknown reference, a partial PO number, and another tenant PO", async () => {
    expect((await resolve("PO/NOPE/1")).statusCode).toBe(404);
    expect((await resolve(PO_NO.slice(0, -1))).statusCode).toBe(404);
    expect((await resolve(FOREIGN_NO)).statusCode).toBe(404);
    expect((await resolve(randomUUID())).statusCode).toBe(404);
  });
  it("requires ref and a reader role", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/procurement/pos/resolve", headers: hdr() })).statusCode).toBe(400);
    expect((await resolve(PO_NO, TENANT, ["citizen"])).statusCode).toBe(403);
  });
});
