/**
 * grant-service — extended route coverage tests.
 *
 * Covers: scheme CRUD routes (POST/GET), beneficiary routes,
 * disbursement routes, application routes, uc-validation routes,
 * dashboard routes. Tests happy path + 400 + 401 + 403 + 404.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { grantInstallments, grantDisbursements } from "../src/modules/disbursement/schema.js";
import { grantUcStatements } from "../src/modules/utilisation/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0000-4000-8000-000000000099";
const ACTOR  = "cccccccc-aaaa-4000-8000-000000000001";
const ACTOR2 = "cccccccc-aaaa-4000-8000-000000000002";

function makeToken(roles: string[] = ["grant_admin", "super_admin"], actor = ACTOR) {
  return signToken({ sub: actor, tid: TENANT, roles, sid: "sess-ext" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await app.close();
  // Cleanup test data
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(grantUcStatements).where(eq(grantUcStatements.tenantId, TENANT));
    await tx.delete(grantDisbursements).where(eq(grantDisbursements.tenantId, TENANT));
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  }));
  await sqlClient.end();
});

// ── Scheme Routes ───────────────────────────────────────────────────────────
describe("POST /v1/grants/schemes", () => {
  it("202 — creates a scheme command", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { code: "SCH-EXT-01", name: "Extended Test Scheme", budgetMinor: 5000000, maxAmountMinor: 1000000 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data?.id ?? body.id).toBeDefined();
  });

  it("400 — missing required field", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: "No code" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/grants/schemes", payload: { code: "X", name: "Y", budgetMinor: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("403 — wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${makeToken(["billing_viewer"])}` },
      payload: { code: "SCH-X", name: "X", budgetMinor: 1000, maxAmountMinor: 500 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/grants/schemes", () => {
  it("200 — returns scheme list with data array", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/schemes",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("401 — no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/grants/schemes" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/grants/schemes/:id", () => {
  it("404 — unknown scheme id", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/schemes/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/grants/schemes/:id/criteria", () => {
  it("400 — invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes/00000000-0000-4000-8000-000000000001/criteria",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes/00000000-0000-4000-8000-000000000001/criteria",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
      payload: { criterionKey: "age", maxValue: "65" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Beneficiary Routes ──────────────────────────────────────────────────────
describe("POST /v1/grants/beneficiaries", () => {
  it("202 — creates beneficiary command", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/beneficiaries",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: "Test Beneficiary", type: "individual" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("400 — missing name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/beneficiaries",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { type: "individual" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/grants/beneficiaries", payload: { name: "X", type: "individual" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 — wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/beneficiaries",
      headers: { authorization: `Bearer ${makeToken(["audit_officer"])}` },
      payload: { name: "X", type: "individual" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/grants/beneficiaries/:id", () => {
  it("404 — unknown beneficiary", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/beneficiaries/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/grants/beneficiaries/:id/bank", () => {
  it("400 — invalid body (no accountNo)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/beneficiaries/00000000-0000-4000-8000-000000000001/bank",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/grants/beneficiaries/:id/aadhaar", () => {
  it("400 — invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/beneficiaries/00000000-0000-4000-8000-000000000001/aadhaar",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Application Routes ──────────────────────────────────────────────────────
describe("POST /v1/grants/schemes/:id/applications", () => {
  it("400 — missing body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes/00000000-0000-4000-8000-000000000001/applications",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/schemes/00000000-0000-4000-8000-000000000001/applications",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
      payload: { beneficiaryId: "00000000-0000-4000-8000-000000000001", purpose: "test", amountRequestedMinor: 100000 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/grants/applications/:id", () => {
  it("404 — unknown application", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/grants/applications/:id/approve", () => {
  it("400 — missing amount", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000001/approve",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/grants/applications/:id/reject", () => {
  it("400 — missing reason", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000001/reject",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/grants/applications/:id/score", () => {
  it("400 — missing score fields", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000001/score",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Disbursement Routes ─────────────────────────────────────────────────────
describe("POST /v1/grants/applications/:id/installments", () => {
  it("400 — missing installments array", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000001/installments",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — audit_officer cannot create installments", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/applications/00000000-0000-4000-8000-000000000001/installments",
      headers: { authorization: `Bearer ${makeToken(["audit_officer"])}` },
      payload: { installments: [{ installmentNo: 1, amountMinor: 1000 }] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/grants/installments/:id/disburse", () => {
  it("202 — accepts disbursement with empty body (mode defaults)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/installments/00000000-0000-4000-8000-000000000001/disburse",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/grants/pfms/reconcile", () => {
  it("400 — missing body fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/pfms/reconcile",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/grants/disbursements/:id/submit-approval", () => {
  it("403 — audit_officer cannot submit for approval", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/disbursements/00000000-0000-4000-8000-000000000001/submit-approval",
      headers: { authorization: `Bearer ${makeToken(["audit_officer"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── UC Validation Routes ────────────────────────────────────────────────────
describe("POST /v1/grants/utilization-certs/:id/validate", () => {
  it("404 — unknown UC id", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/utilization-certs/00000000-0000-4000-8000-000000000000/validate",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { status: "validated" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 — invalid status value", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/utilization-certs/00000000-0000-4000-8000-000000000001/validate",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { status: "invalid_status" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/utilization-certs/00000000-0000-4000-8000-000000000001/validate",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
      payload: { status: "validated" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 — no auth token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/grants/utilization-certs/00000000-0000-4000-8000-000000000001/validate",
      payload: { status: "validated" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/grants/utilization-certs/:id/validation-status", () => {
  it("200 — returns pending for unknown UC (graceful)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/utilization-certs/00000000-0000-4000-8000-000000000000/validation-status",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("pending");
  });
});

// ── Dashboard Routes ────────────────────────────────────────────────────────
describe("GET /v1/grants/dashboard", () => {
  it("200 — returns dashboard stats", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/grants/dashboard",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalGrants).toBeDefined();
    expect(body.disbursedAmount).toBeDefined();
  });

  it("401 — no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/grants/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});
