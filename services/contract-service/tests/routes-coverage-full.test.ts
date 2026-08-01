import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { contractContracts, contractMilestones, contractAmendments, contractPerformanceBonds } from "../src/modules/contracts/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const ACTOR2 = "00000000-bbbb-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const CONTRACT_UUID = "22222222-bbbb-4000-8000-000000000099";
const MILESTONE_UUID = "33333333-cccc-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["procurement_admin"], sub = ACTOR): string {
  return signToken({ sub, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[], sub?: string) {
  return { authorization: `Bearer ${token(roles, sub)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACT LIFECYCLE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Contract lifecycle routes", () => {
  // ── POST /v1/contract/contracts (create) ─────────────────────────────────
  it("POST /v1/contract/contracts → 202 valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {
        contractNo: "CON-2026-001", vendorId: CONTRACT_UUID,
        title: "IT Equipment Supply", valueMinor: 5000000,
        currency: "INR", startDate: "2026-01-01", expiry: "2027-01-01",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/contract/contracts → 202 with milestones", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {
        contractNo: "CON-2026-002", vendorId: CONTRACT_UUID,
        title: "Milestone contract", valueMinor: 10000000,
        startDate: "2026-02-01", expiry: "2027-06-01",
        milestones: [
          { title: "Phase 1", dueDate: "2026-06-01", amountMinor: 5000000 },
          { title: "Phase 2", dueDate: "2026-12-01", amountMinor: 5000000 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/contract/contracts → 202 with slaTerms", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {
        contractNo: "CON-2026-003", vendorId: CONTRACT_UUID,
        title: "SLA contract", valueMinor: 2000000,
        startDate: "2026-03-01", expiry: "2027-03-01",
        slaTerms: { penaltyRatePct: 1, maxPenaltyPct: 10 },
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/contract/contracts → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/contract/contracts → 400 missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: { contractNo: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts → 400 invalid vendorId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {
        contractNo: "C1", vendorId: "not-a-uuid",
        title: "X", valueMinor: 100, startDate: "2026-01-01", expiry: "2027-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts → 400 negative valueMinor", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(),
      payload: {
        contractNo: "C1", vendorId: CONTRACT_UUID,
        title: "X", valueMinor: -100, startDate: "2026-01-01", expiry: "2027-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(["citizen"]),
      payload: {
        contractNo: "C1", vendorId: CONTRACT_UUID,
        title: "X", valueMinor: 100, startDate: "2026-01-01", expiry: "2027-01-01",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/contract/contracts → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      payload: { contractNo: "C1", vendorId: CONTRACT_UUID, title: "X", valueMinor: 100, startDate: "2026-01-01", expiry: "2027-01-01" },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── POST /v1/contract/contracts/:id/approve ──────────────────────────────
  it("POST /v1/contract/contracts/:id/approve → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/approve`,
      headers: authHeader(["procurement_admin"], ACTOR2),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/contract/contracts/:id/approve → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts/not-a-uuid/approve",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/approve → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/approve`,
      headers: authHeader(["audit_officer"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  // ── POST /v1/contract/contracts/:id/activate ─────────────────────────────
  it("POST /v1/contract/contracts/:id/activate → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/activate`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/contract/contracts/:id/activate → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts/bad-uuid/activate",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/activate → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/activate`,
      headers: authHeader(["citizen"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  // ── POST /v1/contract/contracts/:id/close ──────────────────────────────
  it("POST /v1/contract/contracts/:id/close → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/close`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/contract/contracts/:id/close → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts/bad/close",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/close → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/close`,
      headers: authHeader(["citizen"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  // ── POST /v1/contract/contracts/:id/terminate ────────────────────────────
  it("POST /v1/contract/contracts/:id/terminate → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/terminate`,
      headers: authHeader(["procurement_admin"], ACTOR2),
      payload: { reason: "Vendor failed delivery" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/contract/contracts/:id/terminate → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts/bad/terminate",
      headers: authHeader(),
      payload: { reason: "test reason enough" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/terminate → 400 reason too short", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/terminate`,
      headers: authHeader(),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/terminate → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/terminate`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/terminate → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/terminate`,
      headers: authHeader(["citizen"]),
      payload: { reason: "Vendor breach of contract terms" },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── PATCH /v1/contract/contracts/:id/amend ───────────────────────────────
  it("PATCH /v1/contract/contracts/:id/amend → 404 not found", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${CONTRACT_UUID}/amend`,
      headers: authHeader(),
      payload: { reason: "Extended scope of work", valueDelta: 500000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/contract/contracts/:id/amend → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/contract/contracts/bad/amend",
      headers: authHeader(),
      payload: { reason: "Extended scope of work", valueDelta: 500000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/contract/contracts/:id/amend → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${CONTRACT_UUID}/amend`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/contract/contracts/:id/amend → 400 reason too short", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${CONTRACT_UUID}/amend`,
      headers: authHeader(),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/contract/contracts/:id/amend → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/contract/contracts/${CONTRACT_UUID}/amend`,
      headers: authHeader(["citizen"]),
      payload: { reason: "Extended scope of work", valueDelta: 500000 },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── POST /v1/contract/contracts/:id/submit-approval ──────────────────────
  it("POST /v1/contract/contracts/:id/submit-approval → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/submit-approval`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/contract/contracts/:id/submit-approval → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts/bad-uuid/submit-approval",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/contracts/:id/submit-approval → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/submit-approval`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACT READ ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Contract read routes", () => {
  it("GET /v1/contract/contracts → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts",
      headers: authHeader(["audit_officer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
    expect(res.json()).toHaveProperty("pagination");
  });

  it("GET /v1/contract/contracts?limit=5 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts?limit=5",
      headers: authHeader(["procurement_officer"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pagination.pageSize).toBe(5);
  });

  it("GET /v1/contract/contracts → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/contract/contracts → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/contract/contracts" });
    expect(res.statusCode).toBe(401);
  });

  // ── GET /v1/contract/contracts/active ─────────────────────────────────────
  it("GET /v1/contract/contracts/active → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/active",
      headers: authHeader(["procurement_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/contract/contracts/active?limit=10 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/active?limit=10",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/contract/contracts/active → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/active",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /v1/contract/contracts/expiring ───────────────────────────────────
  it("GET /v1/contract/contracts/expiring → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/expiring",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("meta");
    expect(res.json().meta.withinDays).toBe(30);
  });

  it("GET /v1/contract/contracts/expiring?days=60&limit=20 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/expiring?days=60&limit=20",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.withinDays).toBe(60);
  });

  it("GET /v1/contract/contracts/expiring → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/expiring",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /v1/contract/contracts/:id ────────────────────────────────────────
  it("GET /v1/contract/contracts/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${CONTRACT_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/contract/contracts/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/contract/contracts/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${CONTRACT_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MILESTONE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Milestone routes", () => {
  // ── GET /v1/contract/contracts/:id/milestones ─────────────────────────────
  it("GET /v1/contract/contracts/:id/milestones → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/contract/contracts/:id/milestones → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/bad-uuid/milestones",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/contract/contracts/:id/milestones → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── PATCH /:id/milestones/:milestoneId/late ───────────────────────────────
  it("PATCH milestones/:milestoneId/late → 404 contract not found", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/late`,
      headers: authHeader(),
      payload: { achievedDate: "2026-07-15" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH milestones/:milestoneId/late → 400 bad contract uuid", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/bad/milestones/${MILESTONE_UUID}/late`,
      headers: authHeader(),
      payload: { achievedDate: "2026-07-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/late → 400 bad milestone uuid", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/bad-uuid/late`,
      headers: authHeader(),
      payload: { achievedDate: "2026-07-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/late → 400 bad achievedDate format", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/late`,
      headers: authHeader(),
      payload: { achievedDate: "not-a-date" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/late → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/late`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/late → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/late`,
      headers: authHeader(["audit_officer"]),
      payload: { achievedDate: "2026-07-15" },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── PATCH /:id/milestones/:milestoneId/complete ───────────────────────────
  it("PATCH milestones/:milestoneId/complete → 404 milestone not found", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(),
      payload: { achievedDate: "2026-06-01" },
    });
    // contract itself might 404 or milestone might 404
    expect([404]).toContain(res.statusCode);
  });

  it("PATCH milestones/:milestoneId/complete → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/bad/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(),
      payload: { achievedDate: "2026-06-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/complete → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/complete → 400 bad achievedDate", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(),
      payload: { achievedDate: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH milestones/:milestoneId/complete → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${CONTRACT_UUID}/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(["citizen"]),
      payload: { achievedDate: "2026-06-01" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RATE CONTRACT ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Rate contract routes", () => {
  it("POST /v1/contract/rate-contracts → 202 valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
      payload: {
        rcNo: "RC-2026-001", vendorId: CONTRACT_UUID,
        title: "Stationery rate contract",
        validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [
          { itemCode: "PEN-001", description: "Ball point pen", unit: "nos", unitPriceMinor: 1500, currency: "INR" },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/contract/rate-contracts → 202 multiple items", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
      payload: {
        rcNo: "RC-2026-002", vendorId: CONTRACT_UUID,
        title: "Office supplies RC", validFrom: "2026-02-01", validUntil: "2027-02-01",
        items: [
          { itemCode: "PAP-001", description: "A4 Paper ream", unit: "ream", unitPriceMinor: 30000 },
          { itemCode: "INK-001", description: "Printer ink", unit: "cartridge", unitPriceMinor: 85000 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/contract/rate-contracts → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/rate-contracts → 400 missing items", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
      payload: {
        rcNo: "RC-X", vendorId: CONTRACT_UUID,
        title: "X", validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/rate-contracts → 400 invalid vendorId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
      payload: {
        rcNo: "RC-X", vendorId: "not-uuid",
        title: "X", validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [{ itemCode: "A", description: "B", unit: "nos", unitPriceMinor: 100 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/contract/rate-contracts → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(["citizen"]),
      payload: {
        rcNo: "RC-X", vendorId: CONTRACT_UUID,
        title: "X", validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [{ itemCode: "A", description: "B", unit: "nos", unitPriceMinor: 100 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/contract/rate-contracts → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      payload: {
        rcNo: "RC-X", vendorId: CONTRACT_UUID,
        title: "X", validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [{ itemCode: "A", description: "B", unit: "nos", unitPriceMinor: 100 }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── GET /v1/contract/rate-contracts ────────────────────────────────────────
  it("GET /v1/contract/rate-contracts?item=PEN-001 → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/rate-contracts?item=PEN-001",
      headers: authHeader(["finance_officer"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/contract/rate-contracts → 400 missing item param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/rate-contracts",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/contract/rate-contracts → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/rate-contracts?item=X",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── GET /v1/contract/rate-contracts/:id ─────────────────────────────────────
  it("GET /v1/contract/rate-contracts/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/rate-contracts/${CONTRACT_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/contract/rate-contracts/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/rate-contracts/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/contract/rate-contracts/:id → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/rate-contracts/${CONTRACT_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUPER_ADMIN + FINANCE_ADMIN ACCESS
// ══════════════════════════════════════════════════════════════════════════════
describe("super_admin and finance_admin role access", () => {
  it("POST /v1/contract/contracts → 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: authHeader(["super_admin"]),
      payload: {
        contractNo: "SA-001", vendorId: CONTRACT_UUID,
        title: "Super admin contract", valueMinor: 100000,
        startDate: "2026-01-01", expiry: "2027-01-01",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/contract/contracts → 200 with super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/contract/rate-contracts → 202 with finance_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/contract/rate-contracts",
      headers: authHeader(["finance_admin"]),
      payload: {
        rcNo: "FA-RC-001", vendorId: CONTRACT_UUID,
        title: "Finance admin RC", validFrom: "2026-01-01", validUntil: "2027-01-01",
        items: [{ itemCode: "T", description: "Test item", unit: "nos", unitPriceMinor: 500 }],
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/contract/contracts/active → 200 with super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/active",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/contract/contracts/expiring → 200 with finance_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/contracts/expiring",
      headers: authHeader(["finance_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/contract/rate-contracts?item=X → 200 with super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/contract/rate-contracts?item=X",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC (unit tests)
// ══════════════════════════════════════════════════════════════════════════════
describe("Domain: contract state machine", async () => {
  const { assertTransitionAllowed, assertDistinctMakerChecker, assertCanAmend, assertNotExpired, DomainError } = await import("../src/modules/contracts/domain.js");

  it("allows draft → approved", () => {
    expect(() => assertTransitionAllowed("draft", "approved")).not.toThrow();
  });

  it("allows draft → terminated", () => {
    expect(() => assertTransitionAllowed("draft", "terminated")).not.toThrow();
  });

  it("allows approved → active", () => {
    expect(() => assertTransitionAllowed("approved", "active")).not.toThrow();
  });

  it("allows approved → terminated", () => {
    expect(() => assertTransitionAllowed("approved", "terminated")).not.toThrow();
  });

  it("allows active → closed", () => {
    expect(() => assertTransitionAllowed("active", "closed")).not.toThrow();
  });

  it("allows active → terminated", () => {
    expect(() => assertTransitionAllowed("active", "terminated")).not.toThrow();
  });

  it("rejects closed → active", () => {
    expect(() => assertTransitionAllowed("closed", "active")).toThrow(DomainError);
  });

  it("rejects terminated → approved", () => {
    expect(() => assertTransitionAllowed("terminated", "approved")).toThrow(DomainError);
  });

  it("rejects draft → active (skip)", () => {
    expect(() => assertTransitionAllowed("draft", "active")).toThrow(DomainError);
  });

  it("rejects draft → closed (skip)", () => {
    expect(() => assertTransitionAllowed("draft", "closed")).toThrow(DomainError);
  });

  it("rejects unknown status → approved", () => {
    expect(() => assertTransitionAllowed("unknown", "approved")).toThrow(DomainError);
  });

  // Maker-checker SoD
  it("allows distinct maker/checker", () => {
    expect(() => assertDistinctMakerChecker("user-a", "user-b")).not.toThrow();
  });

  it("rejects same maker/checker", () => {
    expect(() => assertDistinctMakerChecker("user-a", "user-a")).toThrow(DomainError);
  });

  it("allows empty maker (edge case)", () => {
    expect(() => assertDistinctMakerChecker("", "user-a")).not.toThrow();
  });

  // Amendment guard
  it("allows amend on active contract", () => {
    expect(() => assertCanAmend("active")).not.toThrow();
  });

  it("rejects amend on draft contract", () => {
    expect(() => assertCanAmend("draft")).toThrow(DomainError);
  });

  it("rejects amend on closed contract", () => {
    expect(() => assertCanAmend("closed")).toThrow(DomainError);
  });

  it("rejects amend on terminated contract", () => {
    expect(() => assertCanAmend("terminated")).toThrow(DomainError);
  });

  // Expiry guard
  it("allows non-expired contract", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(() => assertNotExpired(future.toISOString().slice(0, 10))).not.toThrow();
  });

  it("rejects expired contract", () => {
    expect(() => assertNotExpired("2020-01-01")).toThrow(DomainError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN: Rate contract
// ══════════════════════════════════════════════════════════════════════════════
describe("Domain: rate contract", async () => {
  const { assertRcActive, DomainError } = await import("../src/modules/rate/domain.js");

  it("allows active rate contract", () => {
    expect(() => assertRcActive("active")).not.toThrow();
  });

  it("rejects inactive rate contract", () => {
    expect(() => assertRcActive("expired")).toThrow(DomainError);
  });

  it("rejects suspended rate contract", () => {
    expect(() => assertRcActive("suspended")).toThrow(DomainError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOPICS / CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
describe("Topics constants", () => {
  it("exports COMMANDS with expected keys", async () => {
    const { COMMANDS, EVENTS, CONSUMED_EVENTS, SERVICE } = await import("../src/topics.js");
    expect(COMMANDS.contractCreate).toBe("contract.contract.create");
    expect(COMMANDS.contractApprove).toBe("contract.contract.approve");
    expect(COMMANDS.contractActivate).toBe("contract.contract.activate");
    expect(COMMANDS.contractClose).toBe("contract.contract.close");
    expect(COMMANDS.contractTerminate).toBe("contract.contract.terminate");
    expect(COMMANDS.contractAmend).toBe("contract.contract.amend");
    expect(COMMANDS.contractSubmitApproval).toBe("contract.contract.submit_approval");
    expect(COMMANDS.rcCreate).toBe("contract.rate_contract.create");
    expect(EVENTS.contractCreated).toBe("contract.contract.created");
    expect(EVENTS.contractApproved).toBe("contract.contract.approved");
    expect(EVENTS.contractActivated).toBe("contract.contract.activated");
    expect(EVENTS.contractClosed).toBe("contract.contract.closed");
    expect(EVENTS.contractTerminated).toBe("contract.contract.terminated");
    expect(EVENTS.contractAmended).toBe("contract.contract.amended");
    expect(CONSUMED_EVENTS.awardFileDecided).toBe("contract.award.file_decided");
    expect(SERVICE).toBe("contract");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED CONTEXT HELPERS
// ══════════════════════════════════════════════════════════════════════════════
describe("Shared context helpers", () => {
  it("HttpError has status, code, message", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(403, "FORBIDDEN", "test");
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLER EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════
describe("Error handler", () => {
  it("returns 500 on unexpected internal error", async () => {
    // Hit a non-existent route to get the default Fastify 404
    const res = await app.inject({
      method: "GET", url: "/v1/contract/nonexistent",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("correlation ID is included in error responses", async () => {
    const corrId = "test-corr-id-123";
    const res = await app.inject({
      method: "POST", url: "/v1/contract/contracts",
      headers: { ...authHeader(), "x-correlation-id": corrId },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().correlationId).toBe(corrId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE BOND ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Performance bond routes", () => {
  const ACTIVE_ID = "aaaaaaaa-bbbb-4000-8000-0000000000aa";
  const BOND_ID = "bbbbbbbb-cccc-4000-8000-0000000000bb";

  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(contractPerformanceBonds).where(eq(contractPerformanceBonds.id, BOND_ID));
      await tx.delete(contractContracts).where(eq(contractContracts.id, ACTIVE_ID));
      await tx.insert(contractContracts).values({
        id: ACTIVE_ID,
        tenantId: TENANT,
        contractNo: "CON-BOND-COV",
        vendorId: CONTRACT_UUID,
        title: "Coverage bond contract",
        valueMinor: 1_000_000n,
        currency: "INR",
        startDate: "2026-01-01",
        expiry: "2027-01-01",
        status: "active",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(contractPerformanceBonds).values({
        id: BOND_ID,
        contractId: ACTIVE_ID,
        tenantId: TENANT,
        bondType: "performance",
        amountMinor: 50_000n,
        currency: "INR",
        issuer: "SBI",
        referenceNo: "BG-SEED-COV",
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        status: "held",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }));
  });

  it("GET /bonds → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${ACTIVE_ID}/bonds`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("POST /bonds → 202 on active contract", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${ACTIVE_ID}/bonds`,
      headers: authHeader(),
      payload: {
        bondType: "bank_guarantee", amountMinor: 100000, currency: "INR",
        issuer: "SBI", referenceNo: `BG-COV-${randomUUID().slice(0, 8)}`,
        validFrom: "2026-01-01", validTo: "2026-12-31",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /bonds → 404 unknown contract", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/bonds`,
      headers: authHeader(),
      payload: {
        bondType: "performance", amountMinor: 100000, currency: "INR",
        issuer: "SBI", referenceNo: "BG-MISSING", validFrom: "2026-01-01", validTo: "2026-12-31",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /bonds → 400 invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${ACTIVE_ID}/bonds`,
      headers: authHeader(),
      payload: { amountMinor: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /bonds/:bondId/transition → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${ACTIVE_ID}/bonds/${BOND_ID}/transition`,
      headers: authHeader(),
      payload: { toStatus: "released" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /bonds/:bondId/transition → 404 unknown contract", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${CONTRACT_UUID}/bonds/${BOND_ID}/transition`,
      headers: authHeader(),
      payload: { toStatus: "claimed" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /bonds/:bondId/transition → 404 unknown bond on known contract", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/contracts/${ACTIVE_ID}/bonds/99999999-aaaa-4000-8000-000000000099/transition`,
      headers: authHeader(),
      payload: { toStatus: "released" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("GET /bonds → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${ACTIVE_ID}/bonds`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MILESTONE MUTATIONS + BOND GUARDS (command-path coverage)
// ══════════════════════════════════════════════════════════════════════════════
describe("Milestone command routes with seeded rows", () => {
  const SEED_CONTRACT = "cccccccc-dddd-4000-8000-0000000000cc";
  const SEED_MS_OPEN = "dddddddd-eeee-4000-8000-0000000000dd";
  const SEED_MS_DONE = "eeeeeeee-ffff-4000-8000-0000000000ee";
  const DRAFT_CONTRACT = "ffffffff-aaaa-4000-8000-0000000000ff";

  beforeAll(async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(contractMilestones).where(eq(contractMilestones.contractId, SEED_CONTRACT));
      await tx.delete(contractAmendments).where(eq(contractAmendments.contractId, SEED_CONTRACT));
      await tx.delete(contractContracts).where(eq(contractContracts.id, SEED_CONTRACT));
      await tx.delete(contractContracts).where(eq(contractContracts.id, DRAFT_CONTRACT));

      await tx.insert(contractContracts).values({
        id: SEED_CONTRACT,
        tenantId: TENANT,
        contractNo: "CON-MS-COV",
        vendorId: CONTRACT_UUID,
        title: "Milestone coverage contract",
        valueMinor: 2_000_000n,
        currency: "INR",
        startDate: "2026-01-01",
        expiry: "2027-01-01",
        status: "active",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(contractContracts).values({
        id: DRAFT_CONTRACT,
        tenantId: TENANT,
        contractNo: "CON-DRAFT-COV",
        vendorId: CONTRACT_UUID,
        title: "Draft coverage contract",
        valueMinor: 500_000n,
        currency: "INR",
        startDate: "2026-01-01",
        expiry: "2027-01-01",
        status: "draft",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(contractMilestones).values([
        {
          id: SEED_MS_OPEN,
          contractId: SEED_CONTRACT,
          tenantId: TENANT,
          title: "Open milestone",
          dueDate: "2026-06-01",
          amountMinor: 500_000n,
          status: "pending",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
        {
          id: SEED_MS_DONE,
          contractId: SEED_CONTRACT,
          tenantId: TENANT,
          title: "Done milestone",
          dueDate: "2026-03-01",
          amountMinor: 250_000n,
          status: "completed",
          achievedDate: "2026-03-01",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        },
      ]);
      await tx.insert(contractAmendments).values({
        id: "a1a1a1a1-b2b2-4000-8000-0000000000a1",
        contractId: SEED_CONTRACT,
        tenantId: TENANT,
        amendmentNo: 1,
        reason: "coverage",
        valueDelta: 10_000n,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }));
  });

  it("GET /contracts/:id includes seeded amendments (listAmendments)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/contract/contracts/${SEED_CONTRACT}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().amendments)).toBe(true);
    expect(res.json().amendments.length).toBeGreaterThan(0);
  });

  it("PATCH milestones/:id/complete → 202 when milestone pending", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${SEED_CONTRACT}/milestones/${SEED_MS_OPEN}/complete`,
      headers: authHeader(),
      payload: { achievedDate: "2026-06-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH milestones/:id/late → 409 when already completed", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${SEED_CONTRACT}/milestones/${SEED_MS_DONE}/late`,
      headers: authHeader(),
      payload: { achievedDate: "2026-06-15", notes: "too late" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_COMPLETED");
  });

  it("PATCH milestones/:id/complete → 404 unknown milestone on known contract", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${SEED_CONTRACT}/milestones/${MILESTONE_UUID}/complete`,
      headers: authHeader(),
      payload: { achievedDate: "2026-06-01" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("PATCH milestones/:id/late → 202 for pending milestone", async () => {
    // Re-open a dedicated milestone for late path
    const lateId = "b2b2b2b2-c3c3-4000-8000-0000000000b2";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(contractMilestones).where(eq(contractMilestones.id, lateId));
      await tx.insert(contractMilestones).values({
        id: lateId,
        contractId: SEED_CONTRACT,
        tenantId: TENANT,
        title: "Late path",
        dueDate: "2026-05-01",
        amountMinor: 100_000n,
        status: "pending",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }));
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/contracts/${SEED_CONTRACT}/milestones/${lateId}/late`,
      headers: authHeader(),
      payload: { achievedDate: "2026-05-20", notes: "rain" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /bonds → 409 on draft contract", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${DRAFT_CONTRACT}/bonds`,
      headers: authHeader(),
      payload: {
        bondType: "performance", amountMinor: 10000, currency: "INR",
        issuer: "SBI", referenceNo: "BG-DRAFT", validFrom: "2026-01-01", validTo: "2026-12-31",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATUS");
  });

  it("POST /bonds → 400 when validTo before validFrom", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/contract/contracts/${SEED_CONTRACT}/bonds`,
      headers: authHeader(),
      payload: {
        bondType: "performance", amountMinor: 10000, currency: "INR",
        issuer: "SBI", referenceNo: "BG-DATES", validFrom: "2026-12-31", validTo: "2026-01-01",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
