/**
 * Coverage tests for dmn/routes.ts (22% → target: 80%+).
 * Tests CRUD + execution routes for DMN decision tables.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { sql } from "drizzle-orm";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = randomUUID();

function token(roles: string[] = ["workflow_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dmn" }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  // Clean up test DMN tables
  await db.execute(sql`DELETE FROM workflow.dmn_tables WHERE tenant_id = ${TENANT}`).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/workflow/dmn/tables — create", () => {
  it("creates a decision table and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: {
        name: "Risk Assessment",
        description: "Evaluates risk level based on amount",
        hitPolicy: "FIRST",
        inputs: [{ key: "amount", label: "Amount", type: "number" }],
        outputs: [{ key: "risk", label: "Risk Level", type: "string" }],
        rules: [
          { inputs: { amount: "> 10000" }, outputs: { risk: "high" } },
          { inputs: { amount: "> 5000" }, outputs: { risk: "medium" } },
          { inputs: { amount: "" }, outputs: { risk: "low" } },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe("Risk Assessment");
    expect(body.data.hitPolicy).toBe("FIRST");
    expect(body.data.status).toBe("draft");
    expect(body.data.version).toBe(1);
    expect(body.data.ruleCount).toBe(3);
  });

  it("creates a table with default hit policy FIRST when omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Simple Table" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.hitPolicy).toBe("FIRST");
  });

  it("returns 400 for invalid body (missing name)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { hitPolicy: "UNIQUE" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 403 for read-only role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["workflow_user"]),
      payload: { name: "Forbidden Table" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      payload: { name: "No Auth" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/dmn/tables — list", () => {
  it("returns paginated list (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(typeof body.meta.page).toBe("number");
    expect(typeof body.meta.pageSize).toBe("number");
    expect(typeof body.meta.total).toBe("number");
  });

  it("respects pagination params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables?page=1&pageSize=5",
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.pageSize).toBe(5);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/dmn/tables/:id — single", () => {
  it("returns a single table by id (200)", async () => {
    // Create one first
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Get Single Test", hitPolicy: "UNIQUE" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(["workflow_user"]),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(tableId);
    expect(res.json().data.name).toBe("Get Single Test");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/dmn/tables/not-a-uuid",
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/workflow/dmn/tables/:id — update", () => {
  it("updates a table with optimistic locking (200)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Update Me", hitPolicy: "FIRST" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
      payload: {
        name: "Updated Name",
        hitPolicy: "COLLECT",
        version: 1,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("Updated Name");
    expect(res.json().data.hitPolicy).toBe("COLLECT");
    expect(res.json().data.version).toBe(2);
  });

  it("returns 409 on version conflict", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Conflict Test" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
      payload: { name: "Stale", version: 99 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("VERSION_CONFLICT");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(),
      payload: { name: "Ghost", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for missing version", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "No Version" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
      payload: { name: "Should Fail" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
      payload: { name: "Forbidden", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/workflow/dmn/tables/:id — soft-delete", () => {
  it("soft-deletes a table (204)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Delete Me" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(204);

    // Verify GET returns 404 (soft-deleted)
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(["workflow_user"]),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${randomUUID()}`,
      headers: authHeader(["workflow_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/workflow/dmn/tables/:id/execute — evaluate", () => {
  it("evaluates a FIRST hit-policy table and returns outputs (200)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: {
        name: "Exec Test",
        hitPolicy: "FIRST",
        inputs: [{ key: "score", label: "Score", type: "number" }],
        outputs: [{ key: "grade", label: "Grade", type: "string" }],
        rules: [
          { inputs: { score: ">= 90" }, outputs: { grade: "A" } },
          { inputs: { score: ">= 70" }, outputs: { grade: "B" } },
          { inputs: { score: "" }, outputs: { grade: "C" } },
        ],
      },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${tableId}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: { score: 85 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.matched).toBe(true);
    expect(res.json().data.outputs.grade).toBe("B");
  });

  it("returns 404 for non-existent table", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${randomUUID()}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: { x: 1 } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid body (missing input)", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Validate Exec" },
    });
    const tableId = createRes.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${tableId}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${randomUUID()}/execute`,
      headers: authHeader(["citizen"]),
      payload: { input: { x: 1 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for soft-deleted table", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/dmn/tables",
      headers: authHeader(),
      payload: { name: "Deleted Exec" },
    });
    const tableId = createRes.json().data.id;

    // Soft-delete
    await app.inject({
      method: "DELETE",
      url: `/v1/workflow/dmn/tables/${tableId}`,
      headers: authHeader(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/dmn/tables/${tableId}/execute`,
      headers: authHeader(["workflow_user"]),
      payload: { input: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});
