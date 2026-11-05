/**
 * Route coverage tests for the task forwarding module.
 * Covers: POST /tasks/:id/forward, POST /tasks/:id/recall, GET /tasks/:id/forwards
 * Test patterns: happy path, 400 validation, 401 unauthenticated, 403 unauthorized, 404 not found.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR = "00000000-aaaa-4000-8000-000000000077";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";
const TARGET_USER = "22222222-3333-4000-8000-444444444444";

function token(roles: string[] = ["workflow_user"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

// UAT J14 follow-up: GET /tasks/:id/forwards is for the task participants only (see
// task-forwards-participant-gate.test.ts), so the "no forwards yet" read is made by the
// assignee of a real task (fixture only; the assertions are unchanged).
const OWN_INST = "44444444-5555-4000-8000-000000000077";
const OWN_TASK = "55555555-6666-4000-8000-000000000077";
async function seedOwnTask(): Promise<void> {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.tasks WHERE id = ${OWN_TASK}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE id = ${OWN_INST}`);
  await sqlAsTenant(TENANT, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${OWN_INST}, ${TENANT}, ${"Forwarding fixture"}, ${"active"}, ${ACTOR}, ${ACTOR})`);
  await sqlAsTenant(TENANT, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, assignee_id, is_call, created_by, updated_by)
    VALUES (${OWN_TASK}, ${TENANT}, ${OWN_INST}, ${"Forwarding fixture task"}, ${"pending"}, ${ACTOR}, false, ${ACTOR}, ${ACTOR})`);
}
async function dropOwnTask(): Promise<void> {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.tasks WHERE id = ${OWN_TASK}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE id = ${OWN_INST}`);
}

let app: FastifyInstance;

beforeAll(async () => { await seedOwnTask(); app = await buildApp(); });
afterAll(async () => { await app.close(); await dropOwnTask(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/workflow/tasks/:id/forward
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/workflow/tasks/:id/forward", () => {
  it("returns 404 when task does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: TARGET_USER, remarks: "Please review" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 with missing toUserId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { remarks: "Missing target" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid toUserId (not a uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid task id parameter (not a uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/tasks/not-a-uuid/forward",
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: TARGET_USER },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when remarks exceed 512 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: TARGET_USER, remarks: "x".repeat(513) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      payload: { toUserId: TARGET_USER },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["citizen"]),
      payload: { toUserId: TARGET_USER },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows workflow_admin to forward", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_admin"]),
      payload: { toUserId: TARGET_USER },
    });
    // 404 = task not found (passes auth + validation)
    expect(res.statusCode).toBe(404);
  });

  it("allows super_admin to forward", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["super_admin"]),
      payload: { toUserId: TARGET_USER, remarks: "Urgent" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/workflow/tasks/:id/recall
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/workflow/tasks/:id/recall", () => {
  it("returns 404 when task does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 with invalid task id parameter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/tasks/bad-id/recall",
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when remarks exceed 512 chars", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      headers: authHeader(["workflow_user"]),
      payload: { remarks: "r".repeat(513) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      headers: authHeader(["citizen"]),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows workflow_user to recall (role is permitted)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      headers: authHeader(["workflow_user"]),
      payload: { remarks: "Recalling task" },
    });
    // 404 = task not found (auth passes)
    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/workflow/tasks/:id/forwards
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/workflow/tasks/:id/forwards", () => {
  it("returns 200 with empty array for task with no forwards", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${OWN_TASK}/forwards`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/tasks/not-a-uuid/forwards",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("super_admin can view forwards", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});
