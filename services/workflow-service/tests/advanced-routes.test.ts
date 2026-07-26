/**
 * Advanced routes — integration & coverage tests.
 *
 * Task 14.5: Integration tests for task forwarding (forward + recall + SoD validation)
 * Task 14.8: Route coverage tests for all new endpoints (decisions, assignment)
 *
 * Pattern: buildApp() → app.inject() → assert status + shape.
 * Auth: HS256 bypass via JWT_SECRET=test_secret_for_civitasone_32chr.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const ACTOR = "00000000-aaaa-4000-8000-000000000088";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";
const TARGET_USER = "22222222-3333-4000-8000-444444444444";
const SUBSTITUTE_USER = "33333333-4444-4000-8000-555555555555";

function token(roles: string[] = ["workflow_user"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.5 — Integration tests for task forwarding
// ══════════════════════════════════════════════════════════════════════════════

describe("Task 14.5: POST /v1/workflow/tasks/:id/forward — integration", () => {
  it("returns 202/404 with valid body (passes auth + validation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: TARGET_USER, remarks: "Please review this task" },
    });
    // 404 = task not found in DB (auth + validation passed)
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      payload: { toUserId: TARGET_USER, remarks: "Forward this" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 with invalid UUID in path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/tasks/not-a-valid-uuid/forward",
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: TARGET_USER },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing toUserId in body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { remarks: "no target" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid toUserId (not a uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_user"]),
      payload: { toUserId: "bad-id" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role (SoD: citizens cannot forward)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["citizen"]),
      payload: { toUserId: TARGET_USER },
    });
    expect(res.statusCode).toBe(403);
  });

  it("workflow_admin can forward tasks", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/forward`,
      headers: authHeader(["workflow_admin"]),
      payload: { toUserId: TARGET_USER, remarks: "Admin forwarding" },
    });
    // 404 = task not found, but auth + role check passed
    expect(res.statusCode).toBe(404);
  });
});

describe("Task 14.5: POST /v1/workflow/tasks/:id/recall — integration", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for valid recall request (task does not exist)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/tasks/${VALID_UUID}/recall`,
      headers: authHeader(["workflow_user"]),
      payload: { remarks: "Recalling" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 with invalid task id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/tasks/invalid-uuid/recall",
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
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
});

describe("Task 14.5: GET /v1/workflow/tasks/:id/forwards — integration", () => {
  it("returns 200 with empty array when no forwards exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/tasks/bad-uuid/forwards",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks/${VALID_UUID}/forwards`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.8 — Route coverage: Decision Tables
// ══════════════════════════════════════════════════════════════════════════════

describe("Task 14.8: POST /v1/workflow/decisions — create", () => {
  it("returns 201 with valid body", async () => {
    const uniqueCode = `discount_rules_${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions",
      headers: authHeader(["workflow_admin"]),
      payload: {
        code: uniqueCode,
        name: "Discount Rules",
        hitPolicy: "first",
        inputs: [{ key: "amount", label: "Order Amount", type: "number" }],
        outputs: [{ key: "discount", label: "Discount %", type: "number" }],
        rules: [{ inputs: { amount: "> 1000" }, outputs: { discount: 10 } }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.code).toBe(uniqueCode);
    expect(res.json().data.id).toBeDefined();
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions",
      headers: authHeader(["workflow_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions",
      payload: { code: "test", name: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for workflow_user (admin only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions",
      headers: authHeader(["workflow_user"]),
      payload: { code: "test", name: "Test" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Task 14.8: GET /v1/workflow/decisions — list", () => {
  it("returns 200 with data array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/decisions",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/decisions",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/decisions",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Task 14.8: POST /v1/workflow/decisions/:code/evaluate", () => {
  it("returns 404 for non-existent decision table code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions/nonexistent_table/evaluate",
      headers: authHeader(["workflow_user"]),
      payload: { context: { amount: 500 } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 with missing context field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions/some_table/evaluate",
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions/test_table/evaluate",
      payload: { context: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/decisions/test_table/evaluate",
      headers: authHeader(["citizen"]),
      payload: { context: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.8 — Route coverage: Assignment (Responsibility Matrix)
// ══════════════════════════════════════════════════════════════════════════════

describe("Task 14.8: POST /v1/workflow/assignment/matrix — create", () => {
  it("returns 201 with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_admin"]),
      payload: {
        roleRef: "approver_level_1",
        userId: TARGET_USER,
        priority: 1,
        conditionExpr: "amount > 10000",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toBeDefined();
  });

  it("returns 400 with invalid body (missing roleRef)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_admin"]),
      payload: { userId: TARGET_USER },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid userId (not uuid)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_admin"]),
      payload: { roleRef: "test_role", userId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/matrix",
      payload: { roleRef: "test", userId: TARGET_USER },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for workflow_user (admin only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_user"]),
      payload: { roleRef: "test", userId: TARGET_USER },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Task 14.8: GET /v1/workflow/assignment/matrix — list", () => {
  it("returns 200 with data array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/matrix",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for workflow_user (admin only)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/matrix",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("supports roleRef filter query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/matrix?roleRef=approver_level_1",
      headers: authHeader(["workflow_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TASK 14.8 — Route coverage: Assignment (Substitutions)
// ══════════════════════════════════════════════════════════════════════════════

describe("Task 14.8: POST /v1/workflow/assignment/substitutions — create", () => {
  it("returns 201 with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_admin"]),
      payload: {
        userId: TARGET_USER,
        substituteId: SUBSTITUTE_USER,
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        reason: "On leave",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toBeDefined();
  });

  it("returns 400 with invalid date format", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_admin"]),
      payload: {
        userId: TARGET_USER,
        substituteId: SUBSTITUTE_USER,
        fromDate: "01-01-2026",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/substitutions",
      payload: { userId: TARGET_USER, substituteId: SUBSTITUTE_USER, fromDate: "2026-01-01" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for workflow_user (admin only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_user"]),
      payload: { userId: TARGET_USER, substituteId: SUBSTITUTE_USER, fromDate: "2026-01-01" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Task 14.8: GET /v1/workflow/assignment/substitutions — list", () => {
  it("returns 200 with data array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/substitutions",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for workflow_user (admin only)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/assignment/substitutions",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
