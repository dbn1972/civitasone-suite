/**
 * External Task Pattern — route coverage tests.
 *
 * Covers: POST fetch-and-lock, POST complete, POST fail, POST extend-lock.
 * Validates auth enforcement, role gates, validation, 404/409 responses.
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

// ── POST /v1/workflow/external-tasks/fetch-and-lock ──────────────────────────

describe("POST /v1/workflow/external-tasks/fetch-and-lock", () => {
  it("returns 200 with empty data for no matching tasks", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: {
        workerId: "worker-1",
        topics: ["non_existent_topic"],
        maxTasks: 5,
        lockDurationMs: 60000,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      payload: { workerId: "w", topics: ["t"], maxTasks: 1, lockDurationMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { workerId: "w", topics: ["t"], maxTasks: 1, lockDurationMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing workerId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { topics: ["t"], maxTasks: 1, lockDurationMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty topics array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { workerId: "w", topics: [], maxTasks: 1, lockDurationMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for lockDurationMs below minimum (10000)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { workerId: "w", topics: ["t"], maxTasks: 1, lockDurationMs: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for maxTasks above maximum (50)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/fetch-and-lock",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { workerId: "w", topics: ["t"], maxTasks: 100, lockDurationMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/workflow/external-tasks/:id/complete ────────────────────────────

describe("POST /v1/workflow/external-tasks/:id/complete", () => {
  it("returns 404 for non-existent task", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/complete`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1", result: { output: "done" } },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/complete`,
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/complete`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/not-a-uuid/complete",
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing workerId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/complete`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/workflow/external-tasks/:id/fail ────────────────────────────────

describe("POST /v1/workflow/external-tasks/:id/fail", () => {
  it("returns 404 for non-existent task", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/fail`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1", errorMessage: "timed out", retries: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/fail`,
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/fail`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/external-tasks/bad-uuid/fail",
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ── POST /v1/workflow/external-tasks/:id/extend-lock ─────────────────────────

describe("POST /v1/workflow/external-tasks/:id/extend-lock", () => {
  it("returns 409 for non-existent or unlocked task", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/extend-lock`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1", additionalMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/extend-lock`,
      payload: { workerId: "worker-1", additionalMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/extend-lock`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { workerId: "worker-1", additionalMs: 60000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing additionalMs", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/extend-lock`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for additionalMs below minimum (10000)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/external-tasks/${UNKNOWN_ID}/extend-lock`,
      headers: { authorization: `Bearer ${makeToken(["workflow_worker"])}` },
      payload: { workerId: "worker-1", additionalMs: 500 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
