/**
 * GAP-PROCUREMENT-VENDORS-DETAIL-04 — the EMD and PBG registers accept
 * ?vendorId= so a vendor profile lists only that vendor's securities, filtered
 * in SQL before paging, tenant-scoped, and with a malformed id refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementEmd, procurementPbg } from "../src/modules/security/schema.js";
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

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    const base = { tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR, amountMinor: 100000n };
    await tx.insert(procurementEmd).values([
      { ...base, emdNo: "EMD-A-1", vendorId: VENDOR_A },
      { ...base, emdNo: "EMD-A-2", vendorId: VENDOR_A },
      { ...base, emdNo: "EMD-B-1", vendorId: VENDOR_B },
    ]);
    await tx.insert(procurementPbg).values([
      { ...base, pbgNo: "PBG-A-1", vendorId: VENDOR_A },
      { ...base, pbgNo: "PBG-B-1", vendorId: VENDOR_B },
    ]);
  }));
  await runWithTenant(OTHER_TENANT, () => db.transaction((tx) => tx.insert(procurementEmd).values({
    tenantId: OTHER_TENANT, emdNo: "EMD-OTHER", vendorId: VENDOR_A, createdBy: ACTOR, updatedBy: ACTOR, amountMinor: 1n,
  })));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

const get = (url: string, tenant = TENANT) => app.inject({ method: "GET", url, headers: hdr(["procurement_officer"], tenant) });
const nos = (res: { json: () => { items: Array<Record<string, string>> } }, key: string) => res.json().items.map((r) => r[key]).sort();

describe("GAP-PROCUREMENT-VENDORS-DETAIL-04 vendorId filter", () => {
  it("EMD register is restricted to the vendor when ?vendorId= is given", async () => {
    expect(nos(await get(`/v1/procurement/emd?vendorId=${VENDOR_A}`), "emdNo")).toEqual(["EMD-A-1", "EMD-A-2"]);
    expect(nos(await get(`/v1/procurement/emd?vendorId=${VENDOR_B}`), "emdNo")).toEqual(["EMD-B-1"]);
  });

  it("without the filter the whole tenant register is returned, and never another tenant's rows", async () => {
    expect(nos(await get("/v1/procurement/emd"), "emdNo")).toEqual(["EMD-A-1", "EMD-A-2", "EMD-B-1"]);
    expect(nos(await get(`/v1/procurement/emd?vendorId=${VENDOR_A}`, OTHER_TENANT), "emdNo")).toEqual(["EMD-OTHER"]);
  });

  it("PBG register is restricted to the vendor too", async () => {
    expect(nos(await get(`/v1/procurement/pbg?vendorId=${VENDOR_A}`), "pbgNo")).toEqual(["PBG-A-1"]);
    expect(nos(await get("/v1/procurement/pbg"), "pbgNo")).toEqual(["PBG-A-1", "PBG-B-1"]);
  });

  it("a malformed vendorId is refused with 400, not silently ignored", async () => {
    expect((await get("/v1/procurement/emd?vendorId=not-a-uuid")).statusCode).toBe(400);
    expect((await get("/v1/procurement/pbg?vendorId=not-a-uuid")).statusCode).toBe(400);
  });
});
