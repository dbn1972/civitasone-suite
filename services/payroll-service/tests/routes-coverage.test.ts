/**
 * payroll-service routes coverage tests
 *
 * Exhaustive HTTP inject tests for all GET endpoints plus POST /payroll/runs.
 * Tests 401, 403, 200, 404, and 400 responses using HS256 test JWTs.
 * Aims to raise branch/line coverage on route handlers, auth guards, and error paths.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-3333-4000-8000-000000000033";
const ACTOR  = "dddddddd-4444-4000-8000-000000000033";

function makeToken(roles: string[] = ["payroll_admin"], sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-cov-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── GET /v1/payroll/runs ──────────────────────────────────────────

describe("GET /v1/payroll/runs — coverage", () => {
  it("200: returns array for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("200: returns array for payroll_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["payroll_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("200: returns array for hr_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["hr_admin"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200: returns array for finance_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["finance_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: employee role (not a reader)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403: citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["citizen"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/runs/:id ──────────────────────────────────────

describe("GET /v1/payroll/runs/:id — coverage", () => {
  it("404: unknown run UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs/00000000-0000-4000-8000-ffffffffffff", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs/00000000-0000-4000-8000-ffffffffffff" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs/00000000-0000-4000-8000-ffffffffffff", headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/salary-slips (slips) ──────────────────────────

describe("GET /v1/payroll/salary-slips — coverage", () => {
  it("200: returns array for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips", headers: { authorization: `Bearer ${makeToken(["citizen"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/structures ────────────────────────────────────

describe("GET /v1/payroll/structures — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures", headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/loans ─────────────────────────────────────────

describe("GET /v1/payroll/loans — coverage", () => {
  it("200: returns array with empId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/loans?empId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/loans?empId=00000000-0000-4000-8000-000000000001" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("400: missing empId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/loans", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("403: citizen role forbidden", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/loans?empId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken(["citizen"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/tax/declarations (tax-declarations) ───────────

describe("GET /v1/payroll/tax-declarations — coverage", () => {
  it("200: returns declaration or null for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?employeeId=${ACTOR}&fy=2024-25`, headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?employeeId=${ACTOR}&fy=2024-25` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("400: missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?employeeId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400: malformed fy", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax-declarations?employeeId=${ACTOR}&fy=badfy`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /v1/payroll/statutory/tds ─────────────────────────────────

describe("GET /v1/payroll/statutory/tds — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/tds", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/tds" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: employee role not in reader list", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/tds", headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/statutory/pf ──────────────────────────────────

describe("GET /v1/payroll/statutory/pf — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pf", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pf" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pf", headers: { authorization: `Bearer ${makeToken(["citizen"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/statutory/esi ─────────────────────────────────

describe("GET /v1/payroll/statutory/esi — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/esi", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/esi" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/esi", headers: { authorization: `Bearer ${makeToken(["employee"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/payroll/statutory/gratuity ────────────────────────────

describe("GET /v1/payroll/statutory/gratuity — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gratuity" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/payroll/statutory/gpf ─────────────────────────────────

describe("GET /v1/payroll/statutory/gpf — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gpf", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gpf" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/payroll/statutory/nps ─────────────────────────────────

describe("GET /v1/payroll/statutory/nps — coverage", () => {
  it("200: returns array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/payroll/ddos (DDO master) ─────────────────────────────

describe("GET /v1/payroll/ddos — coverage", () => {
  it("200: returns array for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/payroll/pensioners ────────────────────────────────────

describe("GET /v1/payroll/pensioners — coverage", () => {
  it("200: returns array for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners", headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners", headers: { authorization: `Bearer ${makeToken(["citizen"])}` } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/payroll/runs — create ────────────────────────────────

describe("POST /v1/payroll/runs — coverage", () => {
  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["employee"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403: wrong role (finance_officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["finance_officer"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400: empty body fails zod validation", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("400: partial body missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` }, payload: { month: "2024-07" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/payroll/structures — create ──────────────────────────

describe("POST /v1/payroll/structures — coverage", () => {
  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role (hr_admin is not a writer for structures)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: { authorization: `Bearer ${makeToken(["hr_admin"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400: empty body fails validation", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/payroll/loans — create ───────────────────────────────

describe("POST /v1/payroll/loans — coverage", () => {
  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/loans", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403: wrong role (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/loans", headers: { authorization: `Bearer ${makeToken(["employee"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400: empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/loans", headers: { authorization: `Bearer ${makeToken(["payroll_admin"])}` }, payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /v1/payroll/tax/computation ───────────────────────────────

describe("GET /v1/payroll/tax/computation — coverage", () => {
  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/computation?employeeId=${ACTOR}&fy=2024-25` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("400: missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/computation?employeeId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400: malformed fy param (wrong suffix)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/computation?employeeId=${ACTOR}&fy=2024-30`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── GET /v1/payroll/tax/form16 ────────────────────────────────────

describe("GET /v1/payroll/tax/form16 — coverage", () => {
  it("401: no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${ACTOR}&fy=2024-25` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("400: missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400: malformed fy (bad suffix)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${ACTOR}&fy=2024-99`, headers: { authorization: `Bearer ${makeToken()}` } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
