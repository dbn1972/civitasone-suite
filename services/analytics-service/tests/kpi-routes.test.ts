/**
 * KPI, Data Warehouse, and AI Insights route tests.
 * Validates HTTP shape, auth, and role enforcement.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["analytics_admin"]) {
  return signToken({ sub: "user-kpi-01", tid: TENANT, roles, sid: "sess-kpi-01" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/analytics/kpis", () => {
  it("returns 200 with data + meta shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/kpis",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 200 });
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/kpis",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/kpis" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/analytics/data-warehouse", () => {
  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/data-warehouse",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/data-warehouse" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/analytics/ai-insights", () => {
  it("returns 200 with empty data array (no AI insights yet)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/ai-insights",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 200, total: 0 });
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/ai-insights",
      headers: { authorization: `Bearer ${makeToken(["helpdesk_user"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/ai-insights" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
