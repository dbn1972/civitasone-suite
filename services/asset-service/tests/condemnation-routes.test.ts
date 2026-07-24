/**
 * Condemnation routes — integration tests (SVC-060).
 * Tests: survey CRUD, committee recommendation, auction, auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-dddd-4000-8000-000000000001";
const ACTOR  = "22222222-dddd-4000-8000-000000000001";
const ASSET  = "33333333-dddd-4000-8000-000000000001";
const SURVEY = "44444444-dddd-4000-8000-000000000001";
const REC_ID = "55555555-dddd-4000-8000-000000000001";

function authHeader(roles = ["asset_admin", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("Condemnation Surveys", () => {
  it("POST /v1/assets/condemnation-surveys → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-surveys",
      headers: authHeader(),
      payload: {
        assetId: ASSET, surveyDate: "2026-07-15",
        condition: "beyond_repair", conditionNotes: "Motor burnt, frame cracked",
        yearsInUse: 12, estimatedRepairCostMinor: 8500000,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
  });

  it("POST /v1/assets/condemnation-surveys → 400 invalid condition", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-surveys",
      headers: authHeader(),
      payload: { assetId: ASSET, surveyDate: "2026-07-15", condition: "excellent" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/condemnation-surveys → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-surveys",
      headers: authHeader(["employee"]),
      payload: { assetId: ASSET, surveyDate: "2026-07-15", condition: "poor" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/condemnation-surveys → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-surveys",
      payload: { assetId: ASSET, surveyDate: "2026-07-15", condition: "poor" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /v1/assets/condemnation-surveys/:id/submit → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/condemnation-surveys/${SURVEY}/submit`,
      headers: authHeader(),
      payload: { version: 1, recommendation: "condemn" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("Committee Recommendations", () => {
  it("POST /v1/assets/condemnation-recommendations → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-recommendations",
      headers: authHeader(),
      payload: {
        surveyId: SURVEY, assetId: ASSET,
        committeeMembers: [
          { name: "Shri A Kumar", designation: "Under Secretary" },
          { name: "Smt B Singh", designation: "Accounts Officer" },
          { name: "Shri C Patel", designation: "Technical Officer" },
        ],
        decision: "condemn",
        reason: "Asset beyond economical repair. Repair cost exceeds 80% of replacement value.",
        reserveValueMinor: 50000,
        floorValueMinor: 30000,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/condemnation-recommendations → 400 < 2 members", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/condemnation-recommendations",
      headers: authHeader(),
      payload: {
        surveyId: SURVEY, assetId: ASSET,
        committeeMembers: [{ name: "Solo", designation: "Officer" }],
        decision: "condemn", reason: "test",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/condemnation-recommendations/:id/approve → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/condemnation-recommendations/${REC_ID}/approve`,
      headers: authHeader(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("Auctions", () => {
  it("POST /v1/assets/auctions → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/auctions",
      headers: authHeader(),
      payload: {
        assetId: ASSET, recommendationId: REC_ID,
        reserveValueMinor: 50000, auctionDate: "2026-08-15",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/auctions → 400 zero reserve", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/auctions",
      headers: authHeader(),
      payload: { assetId: ASSET, recommendationId: REC_ID, reserveValueMinor: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/auctions/:id/complete → 202", async () => {
    const fakeId = "66666666-dddd-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/auctions/${fakeId}/complete`,
      headers: authHeader(),
      payload: {
        version: 1, highestBidMinor: 75000,
        winnerName: "M/s ABC Traders", saleProceedsMinor: 75000,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/assets/auctions/:id/complete → 403 wrong role", async () => {
    const fakeId = "66666666-dddd-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/auctions/${fakeId}/complete`,
      headers: authHeader(["employee"]),
      payload: { version: 1, highestBidMinor: 75000, winnerName: "X", saleProceedsMinor: 75000 },
    });
    expect(res.statusCode).toBe(403);
  });
});
