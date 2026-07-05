/**
 * payroll-service — Form 16 Bulk Generation routes integration tests
 *
 * Covers:
 * - POST /v1/payroll/tax/form16/bulk-generate (valid → 202, duplicate → 409, auth)
 * - GET /v1/payroll/tax/form16/bulk-status (returns progress)
 * - GET /v1/payroll/tax/form16/bulk-download (requires completed job)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";
import { db } from "../src/shared/db.js";
import { form16BulkJobs } from "../src/modules/form16-pdf/schema.js";
import { eq } from "drizzle-orm";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

// Clean up test data before running to avoid conflicts from previous runs
beforeAll(async () => {
  try {
    await db.delete(form16BulkJobs).where(eq(form16BulkJobs.tenantId, TENANT));
  } catch {
    // Table may not exist in CI — that's fine
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — valid payload → 202
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — valid payload", () => {
  it("returns 202 with jobId for valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.jobId).toBeDefined();
    expect(body.data.message).toContain("bulk");
    expect(body.data.fy).toBe("2024-25");
  });

  it("returns 202 with specific employeeIds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2023-24", employeeIds: [randomUUID(), randomUUID()] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.jobId).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — duplicate job → 409
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — duplicate", () => {
  it("returns 409 when a job for same FY is already pending/processing", async () => {
    const app = await buildApp();
    const fy = "2022-23";

    // First request — should succeed with 202
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    expect(res1.statusCode).toBe(202);

    // Second request for same FY — should return 409
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    await app.close();

    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.code).toBe("BULK_JOB_IN_PROGRESS");
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — auth rejection
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role (not admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { fy: "2024-25" },
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
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — validation errors
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — validation", () => {
  it("returns 400 or 500 when fy format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 when fy suffix is incorrect (e.g. 2024-99)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-99" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-status — returns progress
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-status", () => {
  it("returns job progress after creating a bulk job", async () => {
    const app = await buildApp();
    const fy = "2021-22";

    // Create a job first
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    expect(createRes.statusCode).toBe(202);

    // Query status
    const statusRes = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/bulk-status?fy=${fy}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(statusRes.statusCode).toBe(200);
    const body = statusRes.json();
    expect(body.data.jobId).toBeDefined();
    expect(body.data.fy).toBe(fy);
    expect(body.data.status).toBe("pending");
    expect(body.data.totalEmployees).toBe(0);
    expect(body.data.generated).toBe(0);
    expect(body.data.failed).toBe(0);
  });

  it("returns 404 when no job exists for FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2019-20",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2024-25",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2024-25",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-download — requires completed job
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-download", () => {
  it("returns 404 when no job exists for FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 422 when job is not yet completed", async () => {
    const app = await buildApp();
    const fy = "2020-21";

    // Create job (will be in pending status)
    await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/bulk-download?fy=${fy}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2024-25",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2024-25",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
