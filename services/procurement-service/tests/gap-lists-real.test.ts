/**
 * gap/routes.ts real-data lift — verifies the previously-stub endpoints
 * (empanelment, bid-evaluations, reverse-auctions, pre-bid-conferences,
 * gem/items) now return actual repo-backed rows instead of hardcoded empty
 * arrays, and that the two honest-empty-with-reason cases (pre-bid
 * conferences' "attendees" concept, gem/items when GEM is disabled) surface
 * a documented `meta.reason` / `meta.integrationDisabled` instead of silently
 * pretending to have data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors, procurementEmpanelment } from "../src/modules/vendor/schema.js";
import { procurementVendorScorecards } from "../src/modules/vendor/scorecard-schema.js";
import { procurementTenders, procurementTenderBids } from "../src/modules/tender/schema.js";
import { procurementPrebidQueries } from "../src/modules/tender/docs-schema.js";
import { procurementAuctions, procurementBids } from "../src/modules/auction/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9a900000-1111-4000-8000-000000000001";
const ACTOR  = "9a900000-2222-4000-8000-000000000002";

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer", "super_admin"], sid: "sess-gap" }, SECRET, 3600);
}

let app: FastifyInstance;
let auth: string;

async function seed(): Promise<{ vendorId: string; tenderId: string; auctionId: string }> {
  const vendorId = randomUUID();
  const tenderId = randomUUID();
  const auctionId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values({
      id: vendorId, tenantId: TENANT, name: "Gap Test Traders", vendorType: "empanelled",
      mse: true, kycStatus: "verified", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementEmpanelment).values({
      id: randomUUID(), vendorId, tenantId: TENANT, category: "IT Hardware",
      empanelDate: "2026-01-01", validUntil: "2027-01-01", status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementVendorScorecards).values({
      id: randomUUID(), tenantId: TENANT, vendorId, period: "all",
      totalOrders: 10, onTimeDeliveries: 9, lateDeliveries: 1, qualityRejections: 0, slaBreaches: 0,
      deliveryScore: 90, qualityScore: 100, slaScore: 100, overallRating: 92, ratingBand: "A",
    });

    await tx.insert(procurementTenders).values({
      id: tenderId, tenantId: TENANT, tenderNo: `TND-GAP-${tenderId.slice(-4)}`, title: "Gap Test Tender",
      type: "open", bidClosingDate: "2026-06-01", status: "technical_evaluation",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementTenderBids).values({
      id: randomUUID(), tenderId, tenantId: TENANT, vendorId, vendorName: "Gap Test Traders",
      technicalScore: 80, technicalQualified: true, financialScore: 70, rank: 1, status: "technically_qualified",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPrebidQueries).values([
      { id: randomUUID(), tenderId, tenantId: TENANT, vendorId, queryNo: 1, question: "Q1?", answer: "A1", status: "answered", published: true, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenderId, tenantId: TENANT, vendorId, queryNo: 2, question: "Q2?", status: "open", published: false, createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    await tx.insert(procurementAuctions).values({
      id: auctionId, tenantId: TENANT, auctionNo: `AUC-GAP-${auctionId.slice(-4)}`, indentRef: "n/a",
      title: "Gap Test Auction", reserveMinor: 100000n,
      startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 3_600_000),
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementBids).values({
      id: randomUUID(), auctionId, tenantId: TENANT, vendorId, bidMinor: 90000n, isMse: true,
      effectiveMinor: 85000n, rank: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return { vendorId, tenderId, auctionId };
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementBids).where(eq(procurementBids.tenantId, TENANT));
    await tx.delete(procurementAuctions).where(eq(procurementAuctions.tenantId, TENANT));
    await tx.delete(procurementPrebidQueries).where(eq(procurementPrebidQueries.tenantId, TENANT));
    await tx.delete(procurementTenderBids).where(eq(procurementTenderBids.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
    await tx.delete(procurementVendorScorecards).where(eq(procurementVendorScorecards.tenantId, TENANT));
    await tx.delete(procurementEmpanelment).where(eq(procurementEmpanelment.tenantId, TENANT));
    await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
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

describe("gap/routes.ts — empanelment (real vendor + scorecard data)", () => {
  it("returns the seeded empanelment row with vendor name and scorecard rating", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/empanelment", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const row = body.data.find((r: { vendorName?: string }) => r.vendorName === "Gap Test Traders");
    expect(row).toBeDefined();
    expect(row.category).toBe("IT Hardware");
    expect(row.status).toBe("active");
    expect(row.rating).toBe(92);
    expect(body.meta.total).toBeGreaterThan(0);
  });
});

describe("gap/routes.ts — bid-evaluations (real tender-bid data)", () => {
  it("returns the seeded bid with technical/financial scores and a real totalScore", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.data.find((r: { bidder?: string }) => r.bidder === "Gap Test Traders");
    expect(row).toBeDefined();
    expect(row.technicalScore).toBe(80);
    expect(row.financialScore).toBe(70);
    expect(row.totalScore).toBe(75); // average of 80/70, not fabricated
    expect(row.rank).toBe(1);
  });

  it("excludes bids that have not entered technical evaluation (technicalScore is null)", async () => {
    const tenderId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(procurementTenders).values({
        id: tenderId, tenantId: TENANT, tenderNo: `TND-UNEVAL-${tenderId.slice(-4)}`, title: "Unevaluated tender",
        type: "open", bidClosingDate: "2026-06-01", status: "published", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(procurementTenderBids).values({
        id: randomUUID(), tenderId, tenantId: TENANT, vendorId: randomUUID(), vendorName: "Not Yet Evaluated Co",
        status: "submitted", createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));
    const res = await app.inject({ method: "GET", url: "/v1/procurement/bid-evaluations", headers: { authorization: `Bearer ${auth}` } });
    const body = res.json();
    const row = body.data.find((r: { bidder?: string }) => r.bidder === "Not Yet Evaluated Co");
    expect(row).toBeUndefined();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementTenders).where(eq(procurementTenders.id, tenderId))));
  });
});

describe("gap/routes.ts — reverse-auctions (real auction + bid data)", () => {
  it("returns the seeded auction with real bidder count and lowest effective bid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/reverse-auctions", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.data.find((r: { item?: string }) => r.item === "Gap Test Auction");
    expect(row).toBeDefined();
    expect(row.startPrice).toBe(1000); // 100000 paise / 100
    expect(row.currentLowest).toBe(850); // 85000 paise / 100 — real MIN(effective_minor)
    expect(row.bidders).toBe(1);
    expect(row.status).toBe("active");
  });
});

describe("gap/routes.ts — pre-bid-conferences (honest aggregate, not fabricated meetings)", () => {
  it("aggregates real pre-bid query counts and documents the attendee-tracking gap via meta.reason", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/pre-bid-conferences", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.data.find((r: { tender?: string }) => typeof r.tender === "string" && r.tender.startsWith("TND-GAP-"));
    expect(row).toBeDefined();
    expect(row.queriesRaised).toBe(2);
    expect(row.responses).toBe(1);
    expect(row.attendees).toBe(0);
    expect(typeof body.meta.reason).toBe("string");
    expect(body.meta.reason.toLowerCase()).toContain("attend");
  });
});

describe("gap/routes.ts — gem/items (integration-disabled honesty, not fabricated data)", () => {
  it("returns empty data + meta.integrationDisabled when GEM_ENABLED is not set", async () => {
    expect(process.env.GEM_ENABLED).not.toBe("true");
    const res = await app.inject({ method: "GET", url: "/v1/procurement/gem/items", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.integrationDisabled).toBe(true);
    expect(typeof body.meta.reason).toBe("string");
  });
});
