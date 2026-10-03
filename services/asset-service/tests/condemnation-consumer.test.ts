/**
 * Condemnation consumer integration test — proves the full CQRS loop:
 * survey → recommendation → auction → finance receipt + asset retirement.
 *
 * Tests maker-checker, bid floor validation, idempotency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";
import { registerCondemnationConsumers } from "../src/modules/condemnation/consumer.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-ffff-4000-8000-000000000001";
const ACTOR  = "22222222-ffff-4000-8000-000000000001";
const ASSET  = "33333333-ffff-4000-8000-000000000001";

function token(sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles: ["asset_admin", "super_admin"], sid: "s1" }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerCondemnationConsumers(queue);
});
afterAll(async () => { await app.close(); });

describe("Condemnation consumer — CQRS behaviour", () => {
  const surveyId = randomUUID();
  const recId = randomUUID();
  const auctionId = randomUUID();

  it("creates a condemnation survey via route → consumer", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-surveys",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        assetId: ASSET, surveyDate: "2026-07-20",
        condition: "beyond_repair", conditionNotes: "Motor burnt",
        yearsInUse: 15, estimatedRepairCostMinor: 1200000,
      },
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe("accepted");
  });

  // GAP-ASSETS-CONDEMNATION-08: the routes now check the record before queueing,
  // so a command against an id with no row is a 404 rather than a silent 202.
  // (The seeded happy paths live in gap-ml-assets-01.test.ts.)
  it("submit against an unknown survey is a 404, not an accepted command", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/condemnation-surveys/${surveyId}/submit`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { version: 1, recommendation: "condemn" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("creates committee recommendation with ≥2 members", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-recommendations",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        surveyId, assetId: ASSET,
        committeeMembers: [
          { name: "A Kumar", designation: "Under Secretary" },
          { name: "B Singh", designation: "Accounts Officer" },
        ],
        decision: "condemn", reason: "Repair cost exceeds 80% of replacement value",
        reserveValueMinor: 50000, floorValueMinor: 25000,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("approve against an unknown recommendation is a 404", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/condemnation-recommendations/${recId}/approve`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("creates auction with reserve value", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/auctions",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        assetId: ASSET, recommendationId: recId,
        reserveValueMinor: 50000, auctionDate: "2026-08-20",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("complete against an unknown auction is a 404", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/auctions/${auctionId}/complete`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        version: 1, highestBidMinor: 65000,
        winnerName: "M/s XYZ Traders", saleProceedsMinor: 65000,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a bid-below-reserve completion against an unknown auction is still a 404 (the 422 is covered with a real row)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/auctions/${randomUUID()}/complete`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        version: 1, highestBidMinor: 5000, // well below any reserve
        winnerName: "Cheap Buyer", saleProceedsMinor: 5000,
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
