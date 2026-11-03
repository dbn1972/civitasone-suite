/**
 * UAT Phase 2 C4: the tender register had no reliable bid count — the list API
 * only carried the never-maintained bids_received counter, so the web showed
 * "—". GET /v1/procurement/tenders now returns bidCount, the number of bid rows
 * per tender (one grouped query, tenant-scoped), matching the detail page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders, procurementTenderBids } from "../src/modules/tender/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const T_TWO = randomUUID();
const T_NONE = randomUUID();

function hdr(tenant = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenant, roles: ["procurement_officer"], sid: `s-${randomUUID()}` }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenant };
}

let app: FastifyInstance;

async function wipe() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, t));
      await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
  app = await buildApp();
  await app.ready();
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values([
      { id: T_TWO, tenantId: TENANT, tenderNo: "TND/C4/1", title: "Two bids", status: "published", bidClosingDate: "2026-12-01", bidsReceived: 0, createdBy: ACTOR, updatedBy: ACTOR },
      { id: T_NONE, tenantId: TENANT, tenderNo: "TND/C4/2", title: "No bids", status: "draft", bidClosingDate: "2026-12-01", bidsReceived: 5, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    for (let i = 0; i < 2; i++) {
      await tx.insert(procurementTenderBids).values({ tenderId: T_TWO, tenantId: TENANT, vendorId: randomUUID(), vendorName: `V${i}`, createdBy: ACTOR, updatedBy: ACTOR });
    }
  }));
  // Another tenant's bid on a tender id must never be counted.
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(procurementTenderBids).values({
    tenderId: T_TWO, tenantId: OTHER, vendorId: randomUUID(), vendorName: "X", createdBy: ACTOR, updatedBy: ACTOR,
  })));
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("C4 tender register bid count", () => {
  it("returns bidCount = the tenant's bid rows per tender (0 when none), not the stale counter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/tenders?limit=50", headers: hdr() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; bidCount?: number; bidsReceived: number }>;
    const byId = new Map(body.map((t) => [t.id, t]));
    expect(byId.get(T_TWO)?.bidCount).toBe(2);
    expect(byId.get(T_NONE)?.bidCount).toBe(0);
  });
});
