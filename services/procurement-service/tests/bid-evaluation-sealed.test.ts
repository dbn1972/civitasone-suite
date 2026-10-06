/**
 * GAP-PROCUREMENT-BID-EVALUATION-05 / 06:
 *  - 05: the bid-evaluation register must return an opaque `tenderId` so the
 *    web can link the tender ref to the tender detail route.
 *  - 06 (sealed-bid discipline, GFR): the financial score must be WITHHELD
 *    (null) until the financial envelope is opened (financialOpened=true);
 *    while sealed, totalScore reflects the technical score only.
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
const TENANT = "9a900000-1111-4000-8000-00000000b1d6";
const ACTOR  = "9a900000-2222-4000-8000-00000000b1d2";

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_admin", "super_admin"], sid: "sess-bid" }, SECRET, 3600);
}

let app: FastifyInstance;
let auth: string;
let sealedTenderId: string;
let openTenderId: string;

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
}

async function seed(): Promise<void> {
  sealedTenderId = randomUUID();
  openTenderId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values([
      { id: sealedTenderId, tenantId: TENANT, tenderNo: "TND-SEALED", title: "Sealed tender", type: "open", bidClosingDate: "2026-06-01", status: "technical_evaluation", createdBy: ACTOR, updatedBy: ACTOR },
      { id: openTenderId, tenantId: TENANT, tenderNo: "TND-OPEN", title: "Opened tender", type: "open", bidClosingDate: "2026-06-01", status: "financial_evaluation", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(procurementTenderBids).values([
      // Technically scored but financial envelope STILL SEALED.
      { id: randomUUID(), tenderId: sealedTenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: "Sealed Bidder", technicalScore: 80, financialScore: 70, financialOpened: false, rank: 1, status: "technically_qualified", createdBy: ACTOR, updatedBy: ACTOR },
      // Financial envelope OPENED.
      { id: randomUUID(), tenderId: openTenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: "Open Bidder", technicalScore: 90, financialScore: 60, financialOpened: true, rank: 1, status: "evaluated", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
}

beforeAll(async () => {
  app = await buildApp();
  auth = token();
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/procurement/bid-evaluations — sealed-bid + tenderId (GAP-PROCUREMENT-BID-EVALUATION-05/06)", () => {
  it("withholds the financial score while the envelope is sealed, and totals on technical only", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const sealed = body.data.find((r: { bidder?: string }) => r.bidder === "Sealed Bidder");
    expect(sealed).toBeDefined();
    expect(sealed.financialScore).toBeNull();
    // totalScore reflects technical only (80), not an average that leaks the
    // sealed financial score.
    expect(sealed.totalScore).toBe(80);
    // GAP-BID-05: tenderId present for linking.
    expect(sealed.tenderId).toBe(sealedTenderId);
  });

  it("reveals the financial score once the envelope is opened, and averages the two", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers: { authorization: `Bearer ${auth}` } });
    const body = res.json();
    const open = body.data.find((r: { bidder?: string }) => r.bidder === "Open Bidder");
    expect(open).toBeDefined();
    expect(open.financialScore).toBe(60);
    expect(open.totalScore).toBe(75); // (90 + 60) / 2
    expect(open.tenderId).toBe(openTenderId);
  });
});
