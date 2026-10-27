/**
 * D4c #22/#23 (GAP-PROCUREMENT-VENDORS-05, VENDORS-DETAIL-05): one rating scale
 * for vendors - out of 100 from the scorecard with its band - on the list and
 * the profile. No scorecard (or no orders yet) is null, never a fabricated 0.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { procurementVendorScorecards } from "../src/modules/vendor/scorecard-schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const SCORED = randomUUID();
const UNSCORED = randomUUID();
const NEW_ONE = randomUUID();
let app: FastifyInstance;
const hdr = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer", "super_admin"], sid: "s" }, SECRET, 3600)}`, "x-tenant-id": TENANT });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const base = { tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR };
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values([
      { ...base, id: SCORED, name: "D4C Scored Vendor" },
      { ...base, id: UNSCORED, name: "D4C Unscored Vendor" },
      { ...base, id: NEW_ONE, name: "D4C No Orders Vendor" },
    ]);
    await tx.insert(procurementVendorScorecards).values([
      { tenantId: TENANT, vendorId: SCORED, period: "all", totalOrders: 10, overallRating: 86, ratingBand: "A" },
      { tenantId: TENANT, vendorId: NEW_ONE, period: "all", totalOrders: 0, overallRating: 0, ratingBand: "unrated" },
    ]);
  }));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("vendor list carries the /100 scorecard score and band", () => {
  it("scored vendor has performanceScore and band; unscored and no-order vendors are null", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/vendors?limit=50", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(SCORED).performanceScore).toBe(86);
    expect(by(SCORED).performanceBand).toBe("A");
    expect(by(UNSCORED).performanceScore).toBeNull();
    expect(by(UNSCORED).performanceBand).toBeNull();
    expect(by(NEW_ONE).performanceScore).toBeNull();
    expect(by(NEW_ONE).performanceBand).toBeNull();
  });
});

describe("vendor profile carries the same score", () => {
  it("GET /vendors/:id returns performanceScore/band", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/procurement/vendors/${SCORED}`, headers: hdr() });
    expect(res.statusCode).toBe(200);
    const d = res.json().data as Record<string, unknown>;
    expect(d.performanceScore).toBe(86);
    expect(d.performanceBand).toBe("A");
    const none = await app.inject({ method: "GET", url: `/v1/procurement/vendors/${UNSCORED}`, headers: hdr() });
    expect((none.json().data as Record<string, unknown>).performanceScore).toBeNull();
  });
});
