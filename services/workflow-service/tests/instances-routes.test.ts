/**
 * workflow-service — Instance lifecycle route coverage tests.
 *
 * Covers: GET /instances, GET /instances/:id/history, POST cancel/suspend/resume/migrate.
 * Validates auth enforcement, role gates, 404 on unknown IDs, and basic response shapes.
 * Uses HS256 test JWT (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000001";

function makeToken(roles: string[] = ["workflow_admin"], sub = "user-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── GET /v1/workflow/instances/:id/history ───────────────────────────────────

describe("GET /v1/workflow/instances/:id/history", () => {
  it("returns 200 with data array for unknown instance (empty history)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/history`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/history`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for malformed UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances/not-a-uuid/history",
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/history`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/workflow/instances/:id/cancel ───────────────────────────────────

describe("POST /v1/workflow/instances/:id/cancel", () => {
  it("returns 404 for non-existent instance", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/cancel`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { reason: "test cancel" },
    });
    await app.close();
    // Instance not found in test DB → 404
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/cancel`,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/cancel`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for malformed UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/instances/bad-id/cancel",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/workflow/instances/:id/suspend ──────────────────────────────────

describe("POST /v1/workflow/instances/:id/suspend", () => {
  it("returns 404 for non-existent instance", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/suspend`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { reason: "test suspend" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/suspend`,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/suspend`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/workflow/instances/:id/resume ───────────────────────────────────

describe("POST /v1/workflow/instances/:id/resume", () => {
  it("returns 404 for non-existent instance", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/resume`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { reason: "test resume" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/resume`,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/resume`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/workflow/instances/:id/migrate ──────────────────────────────────

describe("POST /v1/workflow/instances/:id/migrate", () => {
  it("returns 404 for non-existent instance", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/migrate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { toVersion: 2 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/migrate`,
      payload: { toVersion: 2 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/migrate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: { toVersion: 2 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid body (negative version)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/migrate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { toVersion: -1 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing toVersion field", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/instances/${UNKNOWN_ID}/migrate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/workflow/instances (create) ─────────────────────────────────────

describe("POST /v1/workflow/instances — create", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/instances",
      payload: { definitionCode: "test", data: {} },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/instances",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { definitionCode: "test", data: {} },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/instances",
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
