/**
 * Queries module route tests — catalog, run, scheduled, exports.
 * Validates auth/role enforcement, request validation, and response shapes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-4444-4000-8000-000000000099";

function makeToken(roles: string[] = ["analytics_user"]) {
  return signToken({ sub: "user-qr-01", tid: TENANT, roles, sid: "sess-qr-01" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/analytics/catalog", () => {
  it("returns 200 with catalog object", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/catalog",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics).toBeDefined();
    expect(body.dimensions).toBeDefined();
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/catalog",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/catalog" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/analytics/queries/run", () => {
  it("returns 202 accepted for valid spec", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/queries/run",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: {
        queryName: "test-query",
        spec: { metric: "event_count", dimensions: [], filters: [], limit: 100 },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for invalid body (missing spec)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/queries/run",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { queryName: "bad" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-analytics role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/queries/run",
      headers: { authorization: `Bearer ${makeToken(["employee"])}`, "content-type": "application/json" },
      payload: { queryName: "q", spec: { metric: "event_count", dimensions: [], filters: [], limit: 100 } },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/analytics/queries", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/queries" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/queries",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/analytics/queries/:id", () => {
  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/queries/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/queries/00000000-0000-4000-8000-000000000001" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/analytics/scheduled", () => {
  it("returns 202 for valid schedule body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/scheduled",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: {
        name: "daily-revenue",
        spec: { metric: "amount_sum", dimensions: ["source"], filters: [], limit: 50 },
        cadence: "daily",
        enabled: true,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics/scheduled",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      payload: { name: "incomplete" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/analytics/scheduled", () => {
  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/scheduled" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/scheduled",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/analytics/exports", () => {
  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/exports",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/exports" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
