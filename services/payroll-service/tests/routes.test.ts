/**
 * payroll-service HTTP route tests (inject)
 *
 * Asserts list/detail routes return correct status codes and shapes.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 * No seeded DB rows → routes return [], but schema validates.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000022";

function makeToken(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: "user-payroll-001", tid: TENANT, roles, sid: "sess-002" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/payroll/runs — list shape", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/runs/:id — detail", () => {
  it("returns 404 for unknown UUID", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000000",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/payroll/salary-slips — list shape", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
