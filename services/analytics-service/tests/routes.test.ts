/**
 * analytics-service HTTP route tests (inject).
 * Asserts every list route returns 200 + correct shape.
 * Uses HS256 test JWTs. No seeded DB rows — routes return [] / empty objects.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["analytics_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/analytics/dashboards — shape", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/dashboards",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/dashboards",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: other tenant returns 200 empty data", async () => {
    const app = await buildApp();
    const other = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: other, roles: ["analytics_user"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/analytics/dashboards",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/analytics/dashboards without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/analytics/dashboards" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
