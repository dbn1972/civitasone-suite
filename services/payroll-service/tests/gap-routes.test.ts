/**
 * World-class gap routes — route coverage tests for simulation, corrections,
 * off-cycle, pay-groups, flex benefits, costing, and tax optimization.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-5555-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000099";

function makeToken(roles: string[] = ["payroll_admin"], sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── Gap 1: Simulation ─────────────────────────────────────────────────────────
describe("POST /v1/payroll/runs/:id/simulate", () => {
  it("returns 404 for non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate`, headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs/bad/simulate", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── Gap 3: Corrections ────────────────────────────────────────────────────────
describe("POST /v1/payroll/corrections", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: { authorization: `Bearer ${makeToken(["employee"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/corrections", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/corrections", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

// ── Gap 2: Pay Groups ─────────────────────────────────────────────────────────
describe("POST /v1/payroll/pay-groups", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/pay-groups", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

describe("GET /v1/payroll/calendar", () => {
  it("returns 400 for missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
  it("returns 200 for valid fy", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().fy).toBe("2026-27");
  });
});

// ── Gap 5: Flex Benefits ──────────────────────────────────────────────────────
describe("POST /v1/payroll/flex-benefits/plans", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/flex-benefits/my-elections", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/my-elections", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ── Gap 6: Costing ────────────────────────────────────────────────────────────
describe("POST /v1/payroll/costing/rules", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/costing/report", () => {
  it("returns 400 for missing period", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── Gap 7: Tax Optimization ───────────────────────────────────────────────────
describe("GET /v1/payroll/tax/optimization", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${ACTOR}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 400 for missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/tax/optimization", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
  it("returns 200 with suggestions", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toBeDefined();
  });
});

// ── Gap 8: Off-Cycle ──────────────────────────────────────────────────────────
describe("POST /v1/payroll/off-cycle", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/off-cycle", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/off-cycle", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });
});

describe("POST /v1/payroll/off-cycle/:id/process", () => {
  it("returns 404 for non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/off-cycle/${UNKNOWN_ID}/process`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── Gap 4: State Rules ────────────────────────────────────────────────────────
describe("GET /v1/payroll/statutory/state-rules", () => {
  it("returns 200 with PT and LWF data", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/state-rules", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().ptSlabs).toBeDefined();
    expect(res.json().lwfConfig).toBeDefined();
  });
});
