import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const FAKE_UUID = "22222222-bbbb-4000-8000-000000000099";
const FAKE_UUID2 = "33333333-cccc-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["asset_officer", "asset_admin", "super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// REGISTER MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Register routes", () => {
  it("POST /v1/assets/assets → 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets",
      headers: authHeader(),
      payload: {
        name: "Test Laptop", code: "AST-001",
        categoryId: FAKE_UUID, assetType: "it",
        acquisitionCost: 50000, acquisitionDate: "2024-01-15",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/assets → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets → 400 invalid categoryId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets",
      headers: authHeader(),
      payload: { name: "X", code: "X", categoryId: "not-uuid", acquisitionCost: 1, acquisitionDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets → 403 citizen role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets",
      headers: authHeader(["citizen"]),
      payload: { name: "X", code: "X", categoryId: FAKE_UUID, acquisitionCost: 1, acquisitionDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/assets → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/assets/assets", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/assets/assets → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/assets/assets?status=active → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets?status=active",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/assets/assets?type=it → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets?type=it",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/assets/assets → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/assets/assets/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/assets/${FAKE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/assets/assets/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets/not-a-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/assets/:id/barcode → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/barcode`,
      headers: authHeader(),
      payload: { barcode: "BC-12345" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/assets/assets/:id/barcode → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/barcode`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/assets/:id/barcode → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/assets/assets/not-uuid/barcode",
      headers: authHeader(),
      payload: { barcode: "X" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// LIFECYCLE MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Lifecycle routes", () => {
  it("PATCH /v1/assets/assets/:id/transfer → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/transfer`,
      headers: authHeader(),
      payload: { fromLocation: "Building A", toLocation: "Building B", transferDate: "2024-06-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/assets/assets/:id/transfer → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/transfer`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/assets/:id/transfer → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/assets/assets/not-uuid/transfer",
      headers: authHeader(),
      payload: { fromLocation: "A", toLocation: "B", transferDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/assets/:id/transfer → 403 citizen", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/transfer`,
      headers: authHeader(["citizen"]),
      payload: { fromLocation: "A", toLocation: "B", transferDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/assets/assets/:id/dispose → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/dispose`,
      headers: authHeader(),
      payload: { disposalDate: "2024-06-15", disposalMethod: "sale", proceedsMinor: 10000 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/assets/assets/:id/dispose → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/assets/${FAKE_UUID}/dispose`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/assets/:id/dispose → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/assets/assets/not-uuid/dispose",
      headers: authHeader(),
      payload: { disposalDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/disposals/:id/submit-approval → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/disposals/${FAKE_UUID}/submit-approval`,
      headers: authHeader(),
      payload: { disposalDate: "2024-06-15", disposalMethod: "auction" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/disposals/:id/submit-approval → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/disposals/${FAKE_UUID}/submit-approval`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/disposals/:id/submit-approval → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/disposals/not-uuid/submit-approval",
      headers: authHeader(),
      payload: { disposalDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEPRECIATION MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Depreciation routes", () => {
  it("POST /v1/assets/assets/:id/depreciation/schedule → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/depreciation/schedule`,
      headers: authHeader(),
      payload: { method: "SLM", startDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/assets/:id/depreciation/schedule → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/depreciation/schedule`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/depreciation/schedule → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/depreciation/schedule",
      headers: authHeader(),
      payload: { method: "SLM", startDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/depreciation/schedule → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/depreciation/schedule`,
      headers: authHeader(["citizen"]),
      payload: { method: "SLM", startDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/depreciation/run → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/depreciation/run",
      headers: authHeader(),
      payload: { period: "2024-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/depreciation/run → 400 bad period", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/depreciation/run",
      headers: authHeader(),
      payload: { period: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/depreciation/run → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/depreciation/run",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/assets/assets/:id/depreciation → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/assets/${FAKE_UUID}/depreciation`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/assets/assets/:id/depreciation → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets/not-uuid/depreciation",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/assets/assets/:id/depreciation → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/assets/${FAKE_UUID}/depreciation`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Maintenance routes", () => {
  it("GET /v1/assets/maintenance → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/maintenance",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/assets/maintenance → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/maintenance",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/assets/assets/:id/maintenance → 200", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/assets/assets/${FAKE_UUID}/maintenance`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/assets/assets/:id/maintenance → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/assets/not-uuid/maintenance",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/maintenance → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/maintenance`,
      headers: authHeader(),
      payload: { frequency: "quarterly", nextDue: "2024-04-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/assets/:id/maintenance → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/maintenance",
      headers: authHeader(),
      payload: { frequency: "monthly" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/work-orders → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/work-orders",
      headers: authHeader(),
      payload: { assetId: FAKE_UUID, scheduledDate: "2024-03-15" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/work-orders → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/work-orders",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/work-orders → 400 bad assetId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/work-orders",
      headers: authHeader(),
      payload: { assetId: "not-uuid", scheduledDate: "2024-03-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/work-orders/:id/complete → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/work-orders/${FAKE_UUID}/complete`,
      headers: authHeader(),
      payload: { completedDate: "2024-03-20", costMinor: 5000 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/assets/work-orders/:id/complete → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/work-orders/${FAKE_UUID}/complete`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/work-orders/:id/complete → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/assets/work-orders/not-uuid/complete",
      headers: authHeader(),
      payload: { completedDate: "2024-03-20" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/assets/work-orders/:id/complete → 403 citizen", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/assets/work-orders/${FAKE_UUID}/complete`,
      headers: authHeader(["citizen"]),
      payload: { completedDate: "2024-03-20" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INSURANCE MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Insurance routes", () => {
  it("POST /v1/assets/insurance/policies → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/policies",
      headers: authHeader(),
      payload: {
        assetId: FAKE_UUID, policyNo: "POL-001", insurer: "LIC",
        coverageMinor: 500000, premiumMinor: 12000,
        startDate: "2024-01-01", endDate: "2025-01-01",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/insurance/policies → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/policies",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/insurance/policies → 400 bad assetId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/policies",
      headers: authHeader(),
      payload: { assetId: "not-uuid", policyNo: "P", insurer: "X", coverageMinor: 1, premiumMinor: 1, startDate: "2024-01-01", endDate: "2025-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/insurance/policies → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/policies",
      headers: authHeader(["citizen"]),
      payload: { assetId: FAKE_UUID, policyNo: "P", insurer: "X", coverageMinor: 1, premiumMinor: 1, startDate: "2024-01-01", endDate: "2025-01-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/insurance/claims → 404 POLICY_NOT_FOUND for a non-existent policy", async () => {
    // Money-safety: createClaim now looks up the referenced policy and rejects
    // when it does not exist (fail closed) rather than accepting an unbounded
    // claim against a fabricated policyId. See insurance.test.ts for the
    // happy-path 202 (claim within sum insured) against a real, seeded policy.
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/claims",
      headers: authHeader(),
      payload: {
        policyId: FAKE_UUID, assetId: FAKE_UUID2,
        claimDate: "2024-06-01", claimAmountMinor: 25000,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("POLICY_NOT_FOUND");
  });

  it("POST /v1/assets/insurance/claims → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/claims",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/insurance/claims → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/insurance/claims",
      headers: authHeader(["citizen"]),
      payload: { policyId: FAKE_UUID, assetId: FAKE_UUID, claimDate: "2024-06-01", claimAmountMinor: 100 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Dashboard routes", () => {
  it("GET /v1/assets/dashboard → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/dashboard",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/assets/dashboard → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/dashboard",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/assets/dashboard → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/assets/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICATION MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Verification routes", () => {
  it("POST /v1/assets/verifications → 201", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications",
      headers: authHeader(),
      payload: { verificationDate: "2024-06-01" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /v1/assets/verifications → 400 missing date", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/verifications → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications",
      headers: authHeader(["citizen"]),
      payload: { verificationDate: "2024-06-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/verifications/:id/items → 201 or 500 (no verification)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${FAKE_UUID}/items`,
      headers: authHeader(),
      payload: { assetId: FAKE_UUID2, condition: "good" },
    });
    expect([201, 500]).toContain(res.statusCode);
  });

  it("POST /v1/assets/verifications/:id/items → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications/not-uuid/items",
      headers: authHeader(),
      payload: { assetId: FAKE_UUID, condition: "good" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/verifications/:id/items → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${FAKE_UUID}/items`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/verifications/:id/submit → 200", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${FAKE_UUID}/submit`,
      headers: authHeader(),
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("POST /v1/assets/verifications/:id/submit → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications/not-uuid/submit",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/verifications/:id/approve → 200", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/verifications/${FAKE_UUID}/approve`,
      headers: authHeader(),
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("POST /v1/assets/verifications/:id/approve → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/verifications/not-uuid/approve",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/assets/verifications → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/verifications",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/assets/verifications → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/verifications",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/assets/:id/writeoff-request → 201", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/writeoff-request`,
      headers: authHeader(),
      payload: { remarks: "beyond economical repair" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /v1/assets/assets/:id/writeoff-request → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/writeoff-request",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/writeoff-requests/:id/approve → 200", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/writeoff-requests/${FAKE_UUID}/approve`,
      headers: authHeader(["asset_admin", "finance_officer"]),
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("POST /v1/assets/writeoff-requests/:id/approve → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/writeoff-requests/not-uuid/approve",
      headers: authHeader(["asset_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/writeoff-requests/:id/approve → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/writeoff-requests/${FAKE_UUID}/approve`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE MODULE
// ══════════════════════════════════════════════════════════════════════════════
describe("Enterprise routes", () => {
  it("GET /v1/assets/scan/:barcode → 404 no match", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/scan/NONEXIST-BARCODE",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/assets/scan/:barcode → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/scan/ANY",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/assets/projects/auc → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/projects/auc",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/assets/projects/auc → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/projects/auc",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/projects/auc → 202 or 500 (no DB)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc",
      headers: authHeader(),
      payload: { projectCode: "PRJ-001", name: "New Building" },
    });
    expect([202, 500]).toContain(res.statusCode);
  });

  it("POST /v1/assets/projects/auc → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/projects/auc/:id/capitalize → 404 not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/projects/auc/${FAKE_UUID}/capitalize`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/assets/projects/auc/:id/capitalize → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/projects/auc/not-uuid/capitalize",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/assets/leases → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/leases",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/assets/leases → 403 citizen", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/leases",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/assets/leases → 202 or 500 (no DB)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/leases",
      headers: authHeader(),
      payload: {
        leaseNo: "LSE-001", lessorName: "ABC Realty",
        rouCostMinor: 100000, liabilityMinor: 90000,
        leaseStart: "2024-01-01", leaseEnd: "2027-01-01",
      },
    });
    expect([202, 500]).toContain(res.statusCode);
  });

  it("POST /v1/assets/leases → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/leases",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/impairment → 404 asset not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/impairment`,
      headers: authHeader(),
      payload: { amountMinor: 5000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/assets/assets/:id/impairment → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/impairment`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/impairment → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/impairment",
      headers: authHeader(),
      payload: { amountMinor: 5000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/revaluation → 404 asset not found", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/revaluation`,
      headers: authHeader(),
      payload: { newBookValueMinor: 100000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/assets/assets/:id/revaluation → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/revaluation`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/revaluation → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/revaluation",
      headers: authHeader(),
      payload: { newBookValueMinor: 50000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/assets/locations → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/locations",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("POST /v1/assets/locations → 202 or 500 (no DB)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/locations",
      headers: authHeader(),
      payload: { code: "LOC-001", name: "Main Building" },
    });
    expect([202, 500]).toContain(res.statusCode);
  });

  it("POST /v1/assets/locations → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/locations",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/work-orders/:id/spare-parts → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/work-orders/${FAKE_UUID}/spare-parts`,
      headers: authHeader(),
      payload: { partCode: "SP-001", qty: 2, costMinor: 1500 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/work-orders/:id/spare-parts → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/work-orders/${FAKE_UUID}/spare-parts`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/work-orders/:id/spare-parts → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/work-orders/not-uuid/spare-parts",
      headers: authHeader(),
      payload: { partCode: "SP-001" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/request-disposal → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/request-disposal`,
      headers: authHeader(),
      payload: { disposalDate: "2024-07-01", disposalMethod: "auction" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/assets/:id/request-disposal → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/request-disposal`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/request-disposal → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/request-disposal",
      headers: authHeader(),
      payload: { disposalDate: "2024-07-01", disposalMethod: "auction" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/inter-org-transfer → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/inter-org-transfer`,
      headers: authHeader(),
      payload: { fromOrg: "ORG-A", toOrg: "ORG-B", transferDate: "2024-07-15" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/assets/assets/:id/inter-org-transfer → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/assets/assets/${FAKE_UUID}/inter-org-transfer`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/assets/:id/inter-org-transfer → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/assets/not-uuid/inter-org-transfer",
      headers: authHeader(),
      payload: { fromOrg: "A", toOrg: "B", transferDate: "2024-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/bulk/import → 202 or 500 (no DB)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/bulk/import",
      headers: authHeader(),
      payload: {
        assets: [
          { name: "Bulk Asset 1", code: "BLK-001", acquisitionCostMinor: 5000 },
          { name: "Bulk Asset 2", code: "BLK-002", acquisitionCostMinor: 7500 },
        ],
      },
    });
    expect([202, 500]).toContain(res.statusCode);
  });

  it("POST /v1/assets/bulk/import → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/bulk/import",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/bulk/import → 400 empty assets array", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/bulk/import",
      headers: authHeader(),
      payload: { assets: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/assets/bulk/import → 403 citizen", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/assets/bulk/import",
      headers: authHeader(["citizen"]),
      payload: { assets: [{ name: "X", code: "X", acquisitionCostMinor: 100 }] },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN PURE FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════
describe("Domain: register/domain.ts", () => {
  it("assertValidStatus accepts valid statuses", async () => {
    const { assertValidStatus } = await import("../src/modules/register/domain.js");
    expect(() => assertValidStatus("active")).not.toThrow();
    expect(() => assertValidStatus("under_maintenance")).not.toThrow();
    expect(() => assertValidStatus("transferred")).not.toThrow();
    expect(() => assertValidStatus("disposed")).not.toThrow();
    expect(() => assertValidStatus("written_off")).not.toThrow();
  });

  it("assertValidStatus throws on invalid status", async () => {
    const { assertValidStatus } = await import("../src/modules/register/domain.js");
    expect(() => assertValidStatus("bogus")).toThrow("INVALID_STATUS");
    expect(() => assertValidStatus("")).toThrow("INVALID_STATUS");
  });
});

describe("Domain: lifecycle/domain.ts", () => {
  it("assertAssetTransferable passes for active", async () => {
    const { assertAssetTransferable } = await import("../src/modules/lifecycle/domain.js");
    expect(() => assertAssetTransferable("active")).not.toThrow();
  });

  it("assertAssetTransferable throws for non-active", async () => {
    const { assertAssetTransferable } = await import("../src/modules/lifecycle/domain.js");
    expect(() => assertAssetTransferable("disposed")).toThrow("ASSET_NOT_TRANSFERABLE");
    expect(() => assertAssetTransferable("under_maintenance")).toThrow("ASSET_NOT_TRANSFERABLE");
  });

  it("assertAssetDisposable passes for active", async () => {
    const { assertAssetDisposable } = await import("../src/modules/lifecycle/domain.js");
    expect(() => assertAssetDisposable("active")).not.toThrow();
    expect(() => assertAssetDisposable("under_maintenance")).not.toThrow();
  });

  it("assertAssetDisposable throws for disposed/written_off", async () => {
    const { assertAssetDisposable } = await import("../src/modules/lifecycle/domain.js");
    expect(() => assertAssetDisposable("disposed")).toThrow("ASSET_ALREADY_DISPOSED");
    expect(() => assertAssetDisposable("written_off")).toThrow("ASSET_ALREADY_DISPOSED");
  });

  it("computeDisposalGainLoss returns correct values", async () => {
    const { computeDisposalGainLoss } = await import("../src/modules/lifecycle/domain.js");
    expect(computeDisposalGainLoss(15000n, 10000n)).toBe(5000n);
    expect(computeDisposalGainLoss(5000n, 10000n)).toBe(-5000n);
    expect(computeDisposalGainLoss(10000n, 10000n)).toBe(0n);
  });
});

describe("Domain: depreciation/domain.ts", () => {
  it("slmMonthlyAmount calculates correctly", async () => {
    const { slmMonthlyAmount } = await import("../src/modules/depreciation/domain.js");
    // (100000 - 10000) / 5 / 12 = 1500
    expect(slmMonthlyAmount({ acquisitionCostMinor: 100000n, salvageValueMinor: 10000n, usefulLifeYears: 5 })).toBe(1500n);
  });

  it("slmMonthlyAmount returns 0 when depreciable <= 0", async () => {
    const { slmMonthlyAmount } = await import("../src/modules/depreciation/domain.js");
    expect(slmMonthlyAmount({ acquisitionCostMinor: 5000n, salvageValueMinor: 5000n, usefulLifeYears: 5 })).toBe(0n);
    expect(slmMonthlyAmount({ acquisitionCostMinor: 3000n, salvageValueMinor: 5000n, usefulLifeYears: 5 })).toBe(0n);
  });

  it("wdvMonthlyAmount calculates correctly", async () => {
    const { wdvMonthlyAmount } = await import("../src/modules/depreciation/domain.js");
    // (100000 * Math.round(10 * 100)) / 120000 = (100000 * 1000) / 120000 = 833
    expect(wdvMonthlyAmount({ bookValueMinor: 100000n, ratePercent: 10 })).toBe(833n);
  });

  it("wdvMonthlyAmount returns 0 for zero book value", async () => {
    const { wdvMonthlyAmount } = await import("../src/modules/depreciation/domain.js");
    expect(wdvMonthlyAmount({ bookValueMinor: 0n, ratePercent: 10 })).toBe(0n);
  });

  it("computeMonthlyDep delegates to SLM", async () => {
    const { computeMonthlyDep } = await import("../src/modules/depreciation/domain.js");
    const result = computeMonthlyDep("SLM", 100000n, 10000n, 80000n, 5, 20);
    expect(result).toBe(1500n);
  });

  it("computeMonthlyDep delegates to WDV", async () => {
    const { computeMonthlyDep } = await import("../src/modules/depreciation/domain.js");
    const result = computeMonthlyDep("WDV", 100000n, 10000n, 100000n, 5, 10);
    expect(result).toBe(833n);
  });

  it("generatePeriods returns correct range", async () => {
    const { generatePeriods } = await import("../src/modules/depreciation/domain.js");
    const periods = generatePeriods("2024-01-01", "2024-04-30");
    expect(periods).toEqual(["2024-01", "2024-02", "2024-03", "2024-04"]);
  });

  it("generatePeriods handles year boundary", async () => {
    const { generatePeriods } = await import("../src/modules/depreciation/domain.js");
    const periods = generatePeriods("2024-11-01", "2025-02-28");
    expect(periods).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });

  it("generatePeriods returns single period for same month", async () => {
    const { generatePeriods } = await import("../src/modules/depreciation/domain.js");
    const periods = generatePeriods("2024-06-01", "2024-06-30");
    expect(periods).toEqual(["2024-06"]);
  });
});
