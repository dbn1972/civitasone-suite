/**
 * GAP-PROCUREMENT-TENDERS-DETAIL-02 / 03 / 05: the tender detail endpoint must
 * surface
 *  - 02: the REAL evaluation phase (technical_evaluation / financial_evaluation)
 *    instead of the collapsed "evaluation", plus per-bid financialOpened;
 *  - 03: createdBy + techEvaluatedBy so the web can gate Award (maker-checker);
 *  - 05: emdAmountMinor, documentCount and hasNit so the detail page can show
 *    EMD, a document count and a NIT-missing cue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders, procurementTenderBids } from "../src/modules/tender/schema.js";
import { procurementTenderDocuments } from "../src/modules/tender/docs-schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9a900000-3333-4000-8000-00000000d1e7";
const CREATOR = "9a900000-4444-4000-8000-00000000d1a1";
const TECH_EVAL = "9a900000-5555-4000-8000-00000000d1a2";

function token(): string {
  return signToken({ sub: CREATOR, tid: TENANT, roles: ["procurement_admin", "super_admin"], sid: "sess-det" }, SECRET, 3600);
}

let app: FastifyInstance;
let auth: string;
let tenderId: string;
let openBidId: string;
let sealedBidId: string;

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementTenderDocuments).where(eq(procurementTenderDocuments.tenantId, TENANT));
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
  }));
}

async function seed(): Promise<void> {
  tenderId = randomUUID();
  openBidId = randomUUID();
  sealedBidId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementTenders).values({
      id: tenderId, tenantId: TENANT, tenderNo: "TND-DETAIL", title: "Detail tender",
      type: "open", estimatedMinor: 40_000_000n, emdAmountMinor: 5_000_000n,
      bidClosingDate: "2026-06-01", status: "financial_evaluation",
      techEvaluatedBy: TECH_EVAL, createdBy: CREATOR, updatedBy: CREATOR,
    });
    await tx.insert(procurementTenderBids).values([
      { id: openBidId, tenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: "Opened Bidder", bidAmount: 35_000_000n, technicalScore: 90, financialOpened: true, status: "financial_opened", createdBy: CREATOR, updatedBy: CREATOR },
      { id: sealedBidId, tenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: "Sealed Bidder", bidAmount: 0n, technicalScore: 80, financialOpened: false, status: "technically_qualified", createdBy: CREATOR, updatedBy: CREATOR },
    ]);
    await tx.insert(procurementTenderDocuments).values([
      { id: randomUUID(), tenderId, tenantId: TENANT, docType: "nit", title: "NIT", storageRef: "uploads/x/nit.pdf", isCurrent: true, createdBy: CREATOR, updatedBy: CREATOR },
      { id: randomUUID(), tenderId, tenantId: TENANT, docType: "boq", title: "BOQ", storageRef: "uploads/x/boq.pdf", isCurrent: true, createdBy: CREATOR, updatedBy: CREATOR },
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

describe("GET /v1/procurement/tenders/:id — detail fields (GAP-PROCUREMENT-TENDERS-DETAIL-02/03/05)", () => {
  it("DETAIL-02: returns the real evaluation phase, not the collapsed 'evaluation'", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tenderId}`, headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("financial_evaluation");
  });

  it("DETAIL-02: each bid carries financialOpened, and sealed bids withhold the amount", async () => {
    const body = (await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tenderId}`, headers: { authorization: `Bearer ${auth}` } })).json();
    const open = body.bids.find((b: { bidId: string }) => b.bidId === openBidId);
    const sealed = body.bids.find((b: { bidId: string }) => b.bidId === sealedBidId);
    expect(open.financialOpened).toBe(true);
    expect(open.bidAmount).toBe(350000); // 35,000,000 paise / 100 = rupees
    expect(sealed.financialOpened).toBe(false);
    expect(sealed.bidAmount).toBeUndefined(); // sealed → withheld
  });

  it("DETAIL-03: returns createdBy and techEvaluatedBy for the maker-checker gate", async () => {
    const body = (await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tenderId}`, headers: { authorization: `Bearer ${auth}` } })).json();
    expect(body.createdBy).toBe(CREATOR);
    expect(body.techEvaluatedBy).toBe(TECH_EVAL);
  });

  it("DETAIL-05: returns emdAmountMinor, documentCount and hasNit", async () => {
    const body = (await app.inject({ method: "GET", url: `/v1/procurement/tenders/${tenderId}`, headers: { authorization: `Bearer ${auth}` } })).json();
    expect(body.emdAmountMinor).toBe(5_000_000);
    expect(body.documentCount).toBe(2);
    expect(body.hasNit).toBe(true);
  });
});
