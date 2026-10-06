/**
 * batch6 gap verification — new list-shape fields proven against the real
 * Postgres test DB via the real Fastify app.
 *
 * Covers:
 *  - GAP-PROCUREMENT-PLANNING-01: GET /plans accepts ?year= / ?department= and
 *    filters server-side.
 *  - GAP-PROCUREMENT-PLANNING-02/04: each list row carries the human planNo and
 *    an itemCount (line count), not just a UUID.
 *  - GAP-PROCUREMENT-REVERSE-AUCTION-03: reverse-auction rows carry paise
 *    (startPriceMinor/currentLowestMinor/savingsMinor as integer strings) and a
 *    real endsAt ISO instant, plus auctionNo/indentRef.
 *  - GAP-PROCUREMENT-PRE-BID-01/03: pre-bid rows carry tenderId and a
 *    server-computed openQueries = queriesRaised − responses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementPlans, procurementPlanLines } from "../src/modules/planning/schema.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import { procurementPrebidQueries } from "../src/modules/tender/docs-schema.js";
import { procurementAuctions, procurementBids } from "../src/modules/auction/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b6b60000-1111-4000-8000-000000000001";
const ACTOR = "b6b60000-2222-4000-8000-000000000002";

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer", "procurement_admin", "super_admin"], sid: "sess-b6" }, SECRET, 3600);
}

let app: FastifyInstance;
let auth: string;

async function seed(): Promise<{ planA: string; planB: string; tenderId: string; auctionId: string }> {
  const planA = randomUUID();
  const planB = randomUUID();
  const tenderId = randomUUID();
  const auctionId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    // Two plans in different FYs / departments, with different line counts.
    await tx.insert(procurementPlans).values([
      { id: planA, tenantId: TENANT, planNo: "APP/2026/001", planYear: 2026, title: "FY26 IT plan", department: "IT", status: "draft", totalEstimatedMinor: 20000000n, createdBy: ACTOR, updatedBy: ACTOR },
      { id: planB, tenantId: TENANT, planNo: "APP/2027/001", planYear: 2027, title: "FY27 Finance plan", department: "Finance", status: "draft", totalEstimatedMinor: 10000000n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(procurementPlanLines).values([
      { id: randomUUID(), planId: planA, tenantId: TENANT, itemCode: "LAP-01", description: "Laptop", aggregatedQty: 2, estimatedValueMinor: 10000000n, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), planId: planA, tenantId: TENANT, itemCode: "PRN-01", description: "Printer", aggregatedQty: 1, estimatedValueMinor: 10000000n, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), planId: planB, tenantId: TENANT, itemCode: "CHR-01", description: "Chair", aggregatedQty: 5, estimatedValueMinor: 10000000n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    // A tender with two pre-bid queries (one answered) for openQueries maths.
    await tx.insert(procurementTenders).values({
      id: tenderId, tenantId: TENANT, tenderNo: `TND-B6-${tenderId.slice(-4)}`, title: "B6 Tender",
      type: "open", bidClosingDate: "2026-06-01", status: "published", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPrebidQueries).values([
      { id: randomUUID(), tenderId, tenantId: TENANT, vendorId: randomUUID(), queryNo: 1, question: "Q1?", answer: "A1", status: "answered", published: true, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenderId, tenantId: TENANT, vendorId: randomUUID(), queryNo: 2, question: "Q2?", status: "open", published: false, createdBy: ACTOR, updatedBy: ACTOR },
      { id: randomUUID(), tenderId, tenantId: TENANT, vendorId: randomUUID(), queryNo: 3, question: "Q3?", status: "open", published: false, createdBy: ACTOR, updatedBy: ACTOR },
    ]);

    // A live auction: reserve 100000 paise, lowest effective 85000 → savings 15000.
    await tx.insert(procurementAuctions).values({
      id: auctionId, tenantId: TENANT, auctionNo: `AUC-B6-${auctionId.slice(-4)}`, indentRef: "IND-B6-01",
      title: "B6 Auction", reserveMinor: 100000n,
      startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 3_600_000),
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementBids).values({
      id: randomUUID(), auctionId, tenantId: TENANT, vendorId: randomUUID(), bidMinor: 90000n, isMse: true,
      effectiveMinor: 85000n, rank: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return { planA, planB, tenderId, auctionId };
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementBids).where(eq(procurementBids.tenantId, TENANT));
    await tx.delete(procurementAuctions).where(eq(procurementAuctions.tenantId, TENANT));
    await tx.delete(procurementPrebidQueries).where(eq(procurementPrebidQueries.tenantId, TENANT));
    await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, TENANT));
    await tx.delete(procurementPlanLines).where(eq(procurementPlanLines.tenantId, TENANT));
    await tx.delete(procurementPlans).where(eq(procurementPlans.tenantId, TENANT));
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

describe("GAP-PROCUREMENT-PLANNING-01/02/04 — plans list filter + planNo + itemCount", () => {
  it("returns both plans with planNo and a real itemCount when unfiltered", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/plans", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rowA = body.data.find((r: { planNo?: string }) => r.planNo === "APP/2026/001");
    const rowB = body.data.find((r: { planNo?: string }) => r.planNo === "APP/2027/001");
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA.itemCount).toBe(2);
    expect(rowB.itemCount).toBe(1);
  });

  it("filters by year", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/plans?year=2026", headers: { authorization: `Bearer ${auth}` } });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].planYear).toBe(2026);
    expect(body.data[0].department).toBe("IT");
  });

  it("filters by department", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/plans?department=Finance", headers: { authorization: `Bearer ${auth}` } });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].department).toBe("Finance");
  });
});

describe("GAP-PROCUREMENT-REVERSE-AUCTION-03 — paise + savings + endsAt", () => {
  it("returns integer-string minor units, a positive savings, and an ISO endsAt", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/reverse-auctions", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((r: { item?: string }) => r.item === "B6 Auction");
    expect(row).toBeDefined();
    expect(row.startPriceMinor).toBe("100000");
    expect(row.currentLowestMinor).toBe("85000");
    expect(row.savingsMinor).toBe("15000");
    expect(typeof row.auctionNo).toBe("string");
    expect(row.indentRef).toBe("IND-B6-01");
    expect(() => new Date(row.endsAt).toISOString()).not.toThrow();
    expect(new Date(row.endsAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GAP-PROCUREMENT-PRE-BID-01/03 — tenderId + openQueries", () => {
  it("returns tenderId and openQueries = queriesRaised − responses", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/pre-bid-conferences", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((r: { tender?: string }) => typeof r.tender === "string" && r.tender.startsWith("TND-B6-"));
    expect(row).toBeDefined();
    expect(typeof row.tenderId).toBe("string");
    expect(row.queriesRaised).toBe(3);
    expect(row.responses).toBe(1);
    expect(row.openQueries).toBe(2);
  });
});
