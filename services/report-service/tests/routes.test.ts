/**
 * report-service HTTP route tests (inject).
 * Asserts every list/detail/dashboard route returns 200 + correct shape.
 * Uses HS256 test JWTs. No seeded DB rows — routes return [] / empty objects.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["report_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/reports/dashboards — shape", () => {
  it("returns 200 with dashboard shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/dashboards",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.kpis)).toBe(true);
  });
});

describe("GET /v1/reports/report-jobs — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/report-jobs",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/report-jobs",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: other tenant returns 200 empty", async () => {
    const app = await buildApp();
    const other = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: other, roles: ["report_user"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/report-jobs",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /v1/reports/report-jobs/:id — 404 for missing", () => {
  it("returns 404 for non-existent id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/report-jobs/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/reports/kpis — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/kpis",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/reports/mis — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/mis",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/reports/report-jobs without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/reports/report-jobs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
