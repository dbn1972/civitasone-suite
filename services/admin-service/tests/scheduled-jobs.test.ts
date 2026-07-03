/**
 * admin-service — scheduled-jobs route tests.
 * Tests CRUD, pause/resume, run-now, history, auth, and validation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
const VALID_UUID = "11111111-cccc-4000-8000-333333333333";

function token(roles: string[] = ["super_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-sj" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/scheduled-jobs — LIST
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/scheduled-jobs", () => {
  it("returns data for super_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns data for platform_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/scheduled-jobs" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/scheduled-jobs — CREATE
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/scheduled-jobs", () => {
  it("returns 202 with valid full body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test Job", cronExpression: "0 8 * * *", targetService: "admin-service", targetCommand: "admin.backup.trigger", timezone: "Asia/Kolkata", payload: { type: "full" } },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with minimal body (defaults applied)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "Minimal Job", cronExpression: "*/15 * * * *", targetService: "report-service", targetCommand: "report.generate" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid cron expression", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "Bad Cron", cronExpression: "not-a-cron", targetService: "admin-service", targetCommand: "test.cmd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty cron expression", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "Empty Cron", cronExpression: "", targetService: "admin-service", targetCommand: "test.cmd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "No Target" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with name too long (>200)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["super_admin"]),
      payload: { name: "x".repeat(201), cronExpression: "0 8 * * *", targetService: "a", targetCommand: "b" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs",
      headers: authHeader(["tenant_admin"]),
      payload: { name: "Job", cronExpression: "0 8 * * *", targetService: "a", targetCommand: "b" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /v1/admin/scheduled-jobs/:id — UPDATE
// ══════════════════════════════════════════════════════════════════════════════
describe("PUT /v1/admin/scheduled-jobs/:id", () => {
  it("returns 202 with valid update", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/scheduled-jobs/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: { name: "Updated Job Name", cronExpression: "0 9 * * *" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/scheduled-jobs/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid uuid param", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/scheduled-jobs/not-a-uuid",
      headers: authHeader(["super_admin"]),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid cron on update", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/scheduled-jobs/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: { cronExpression: "bad" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/admin/scheduled-jobs/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/admin/scheduled-jobs/:id", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/scheduled-jobs/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/admin/scheduled-jobs/bad-id",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/scheduled-jobs/${VALID_UUID}`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/scheduled-jobs/:id/run-now
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/scheduled-jobs/:id/run-now", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/run-now`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs/invalid/run-now",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/run-now`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/scheduled-jobs/:id/pause
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/scheduled-jobs/:id/pause", () => {
  it("returns 202 for platform_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/pause`,
      headers: authHeader(["platform_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/scheduled-jobs/xyz/pause",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/scheduled-jobs/:id/resume
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/scheduled-jobs/:id/resume", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/resume`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/resume`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/scheduled-jobs/:id/history
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/scheduled-jobs/:id/history", () => {
  it("does not return 403 for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/history`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/scheduled-jobs/bad/history",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/scheduled-jobs/${VALID_UUID}/history`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
