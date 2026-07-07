/**
 * Route-level tests for pipelines, forecast, and custom-fields routes.
 * Covers: 200/201/202, 400, 401, 403, 404 per requirement 23.2.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const VALID_UUID = "11111111-2222-4000-8000-333333333333";

function token(roles: string[] = ["crm_user"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/crm/pipelines", () => {
  it("returns 202 with valid body (3 stages min)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      headers: authHeader(["crm_admin"]),
      payload: {
        name: "Sales Pipeline",
        stages: [
          { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "Lead", probability: 10, ordinal: 1 },
          { id: "aaaaaaaa-0001-4000-8000-000000000002", name: "Qualified", probability: 30, ordinal: 2 },
          { id: "aaaaaaaa-0001-4000-8000-000000000003", name: "Won", probability: 100, ordinal: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      headers: authHeader(["crm_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with fewer than 3 stages", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      headers: authHeader(["crm_user"]),
      payload: {
        name: "Pipeline",
        stages: [{ id: "aaaaaaaa-0001-4000-8000-000000000001", name: "Lead", probability: 10, ordinal: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing name", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      headers: authHeader(["crm_user"]),
      payload: {
        stages: [
          { id: "aaaaaaaa-0001-4000-8000-000000000001", name: "A", probability: 10, ordinal: 1 },
          { id: "aaaaaaaa-0001-4000-8000-000000000002", name: "B", probability: 50, ordinal: 2 },
          { id: "aaaaaaaa-0001-4000-8000-000000000003", name: "C", probability: 100, ordinal: 3 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/pipelines",
      headers: authHeader(["citizen"]),
      payload: { name: "Test", stages: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/pipelines", () => {
  it("returns 200 with paginated list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/pipelines",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 200 with limit and offset params", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/pipelines?limit=5&offset=0",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/pipelines",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/pipelines",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/pipelines/:id", () => {
  it("returns 404 for non-existent pipeline", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/pipelines/bad-id",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/pipelines/${VALID_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/crm/pipelines/:id", () => {
  it("returns 202 with valid update (name + version)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
      payload: { name: "Updated Pipeline", version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing version", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with neither name nor stages", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/crm/pipelines/not-uuid",
      headers: authHeader(["crm_admin"]),
      payload: { name: "Updated", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/pipelines/${VALID_UUID}`,
      payload: { name: "Test", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["citizen"]),
      payload: { name: "Test", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/crm/pipelines/:id", () => {
  it("returns 202 for valid delete", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/crm/pipelines/bad-id",
      headers: authHeader(["crm_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/crm/pipelines/${VALID_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/crm/pipelines/${VALID_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FORECAST ROUTE
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/forecast", () => {
  it("returns 200 with forecast data", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/forecast",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.totalForecast).toBeDefined();
    expect(body.data.dealCount).toBeDefined();
    expect(body.data.stages).toBeDefined();
  });

  it("returns 200 with pipelineId filter", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/forecast?pipelineId=${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with invalid pipelineId", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/forecast?pipelineId=not-a-uuid",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/forecast",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/forecast",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM FIELDS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/custom-fields/:entityType", () => {
  it("returns 400 for invalid entity type", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/custom-fields/invalid",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/custom-fields/leads",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/custom-fields/leads",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/custom-fields/definition/:id", () => {
  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/crm/custom-fields/definition/bad-id",
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/custom-fields/definition/${VALID_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/crm/custom-fields/definition/${VALID_UUID}`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/crm/custom-fields", () => {
  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      headers: authHeader(["crm_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid entity type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      headers: authHeader(["crm_admin"]),
      payload: { entityType: "invalid", fieldName: "test", fieldType: "text" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid field type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      headers: authHeader(["crm_admin"]),
      payload: { entityType: "leads", fieldName: "test", fieldType: "invalid_type" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty fieldName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      headers: authHeader(["crm_admin"]),
      payload: { entityType: "leads", fieldName: "", fieldType: "text" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      payload: { entityType: "leads", fieldName: "test", fieldType: "text" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/crm/custom-fields",
      headers: authHeader(["crm_user"]),
      payload: { entityType: "leads", fieldName: "test", fieldType: "text" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/crm/custom-fields/:id", () => {
  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/custom-fields/${VALID_UUID}`,
      headers: authHeader(["crm_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/crm/custom-fields/not-uuid",
      headers: authHeader(["crm_admin"]),
      payload: { fieldName: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/custom-fields/${VALID_UUID}`,
      payload: { fieldName: "test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/crm/custom-fields/${VALID_UUID}`,
      headers: authHeader(["crm_user"]),
      payload: { fieldName: "test" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/crm/custom-fields/:id", () => {
  it("returns 400 with invalid id", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/crm/custom-fields/not-uuid",
      headers: authHeader(["crm_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/crm/custom-fields/${VALID_UUID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/crm/custom-fields/${VALID_UUID}`,
      headers: authHeader(["crm_user"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
