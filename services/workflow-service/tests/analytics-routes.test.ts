/**
 * Coverage tests for analytics/routes.ts (38% → target: 80%+).
 * Tests all analytics endpoints: summary, bottlenecks, cycle-time,
 * automation-rate, sla-compliance, version-comparison, assignment-recommendations.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function token(roles: string[] = ["workflow_user"]): string {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "sess-analytics" }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/workflow/analytics/summary", () => {
  it("returns 200 with summary shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/summary",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveProperty("instancesByStatus");
    expect(data).toHaveProperty("totalInstances");
    expect(data).toHaveProperty("avgCycleTimeSeconds");
    expect(data).toHaveProperty("slaBreachRate");
    expect(data).toHaveProperty("escalations");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/summary",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/analytics/bottlenecks", () => {
  it("returns 200 with bottlenecks shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/bottlenecks",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveProperty("nodes");
    expect(data).toHaveProperty("pendingByRole");
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.pendingByRole)).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/bottlenecks" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/bottlenecks",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/analytics/cycle-time", () => {
  it("returns 200 with array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/cycle-time",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("accepts limit query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/cycle-time?limit=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/cycle-time" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/analytics/automation-rate", () => {
  it("returns 200 with automation rate shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/automation-rate",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveProperty("totalCompleted");
    expect(data).toHaveProperty("humanCompleted");
    expect(data).toHaveProperty("autoCompleted");
    expect(data).toHaveProperty("automationRatePct");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/automation-rate" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/automation-rate",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/workflow/analytics/sla-compliance", () => {
  it("returns 200 with array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/sla-compliance",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("accepts limit query param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/sla-compliance?limit=10",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/sla-compliance" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/analytics/version-comparison", () => {
  it("returns 200 with array for a valid code", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/version-comparison?code=leave_approval",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 400 when code param is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/version-comparison",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/workflow/analytics/version-comparison?code=x" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/analytics/assignment-recommendations", () => {
  it("returns 200 with array for a valid roleRef", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/assignment-recommendations?roleRef=approver&limit=5",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 400 when roleRef param is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/assignment-recommendations",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/assignment-recommendations?roleRef=x",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/analytics/assignment-recommendations?roleRef=x",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
