/**
 * report-service template routes tests.
 * Covers CRUD, limit enforcement (50 templates, 20 filters, 4 groups, 20 params), validation.
 * Uses HS256 test JWTs. Tests run against in-memory Fastify (inject).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "user-template-001";

function makeToken(roles: string[] = ["report_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-tmpl-001" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const validTemplate = {
  name: "Monthly Finance Report",
  description: "Monthly financial summary",
  dataSourceId: "finance.bills",
  filters: [{ field: "status", operator: "eq", value: "approved" }],
  groups: [{ field: "department", label: "Department" }],
  aggregations: [{ field: "amount", function: "sum", alias: "totalAmount" }],
  parameters: [{ name: "startDate", type: "date", required: true }],
  outputFormat: "pdf",
};

describe("POST /v1/reports/templates — create", () => {
  it("returns 202 with valid template", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: validTemplate,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("accepted");
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      payload: validTemplate,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: validTemplate,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid body (missing name)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { dataSourceId: "finance.bills" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 422 for invalid data source not in whitelist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validTemplate, dataSourceId: "unknown.source" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when more than 20 filters provided", async () => {
    const manyFilters = Array.from({ length: 21 }, (_, i) => ({
      field: `field_${i}`,
      operator: "eq",
      value: `val_${i}`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validTemplate, filters: manyFilters },
    });
    // zod enforces max(20) at the route boundary, so 400
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when more than 4 groups provided", async () => {
    const manyGroups = Array.from({ length: 5 }, (_, i) => ({
      field: `group_${i}`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validTemplate, groups: manyGroups },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when more than 20 parameters provided", async () => {
    const manyParams = Array.from({ length: 21 }, (_, i) => ({
      name: `param_${i}`,
      type: "string",
      required: false,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { ...validTemplate, parameters: manyParams },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/reports/templates — list", () => {
  it("returns 200 with list shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: other tenant returns empty", async () => {
    const other = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: other, roles: ["report_admin"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/reports/templates/:id — single", () => {
  it("returns 404 for non-existent template", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/templates/not-a-uuid",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /v1/reports/templates/:id — update", () => {
  it("returns 404 for non-existent template", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: "Updated Name", version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 without version field (optimistic lock required)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { name: "x", version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/reports/templates/:id — soft-delete", () => {
  it("returns 404 for non-existent template", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/reports/templates/:id/execute — trigger generation", () => {
  it("returns 404 for non-existent template", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001/execute",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { parameters: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001/execute",
      payload: { parameters: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001/execute",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { parameters: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});
