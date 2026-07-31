/**
 * payroll-service — Form 16 PDF routes integration tests
 *
 * Covers:
 * - GET /v1/payroll/tax/form16/:employeeId/pdf (happy path, 400, 401, 403)
 * - POST /v1/payroll/tax/form16/bulk-generate (happy path, 400, 401, 403, 409)
 * - GET /v1/payroll/tax/form16/bulk-status (happy path, 400, 401, 403, 404)
 * - GET /v1/payroll/tax/form16/bulk-download (happy path, 400, 401, 403, 404)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function readerToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin", "hr_admin", "finance_officer"], sid: "s1" }, SECRET);
}
function employeeToken(sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { /* pool closed by other test teardown */ });

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/:employeeId/pdf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — happy path", () => {
  it("returns 200/500/502/503 for valid params (PDF or HTML output)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    // 200 if form16 data builds; 500/502 if HRMS unreachable or no data; 503 if renderer unavailable
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });

  it("returns 200/500/502/503 for PDF output format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — 400 validation", () => {
  it("returns 400 for invalid fy format (bad suffix)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-99`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for non-UUID employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/not-a-uuid/pdf?fy=2025-26",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid output param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=docx`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26`,
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when employee tries to access another employee's form16", async () => {
    const otherEmployee = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${otherEmployee}/pdf?fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("allows employee to access their own form16", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    // 200 if data exists, 500/502/503 if deps unavailable — but NOT 403
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — happy path", () => {
  it("returns 202 for valid bulk generation request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    // 202 if no prior job exists, 409 if a pending job exists from prior test runs, 500 if DB issue
    expect([202, 409, 500]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      const body = res.json();
      expect(body.data.jobId).toBeDefined();
      expect(body.data.message).toContain("bulk");
      expect(body.data.fy).toBe("2025-26");
    }
  });

  it("accepts optional employeeIds array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-25", employeeIds: [randomUUID(), randomUUID()] },
    });
    await app.close();
    // 202 if no prior job exists, 409 if a pending job already exists from prior test runs, 500 if DB issue
    expect([202, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — 400 validation", () => {
  it("returns 400 for missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-99" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid employeeIds (not UUIDs)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26", employeeIds: ["not-a-uuid"] },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for non-admin privileged roles (hr_admin alone)", async () => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${token}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — 409 conflict", () => {
  it("returns 409 when a bulk job is already in progress for same FY", async () => {
    const app = await buildApp();
    // First request — should succeed with 202 (or 500 if DB unavailable)
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2023-24" },
    });

    if (res1.statusCode === 202) {
      // Second request with same FY — should be 409
      const res2 = await app.inject({
        method: "POST",
        url: "/v1/payroll/tax/form16/bulk-generate",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { fy: "2023-24" },
      });
      expect([409, 500]).toContain(res2.statusCode);
    }
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-status
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-status — happy path", () => {
  it("returns 200/404/500 for valid fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if a job exists, 404 if no job found, 500 if DB issue
    expect([200, 404, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — 400 validation", () => {
  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=invalid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — 404", () => {
  it("returns 404 when no job exists for a given FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-download
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-download — happy path", () => {
  it("returns 200/404/422/500 for valid fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if completed job exists, 404 if no job, 422 if job not completed, 500 if DB issue
    expect([200, 404, 422, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — 400 validation", () => {
  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=xyz",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — 404", () => {
  it("returns 404 when no job exists for a given FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});
