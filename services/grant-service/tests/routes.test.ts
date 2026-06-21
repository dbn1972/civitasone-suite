/**
 * grant-service HTTP route tests (inject)
 *
 * Asserts key list routes return 200 + correct shape.
 * Uses HS256 test JWTs. No seeded rows — empty results still pass schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-4444-4000-8000-000000000044";

function makeToken(roles: string[] = ["grant_officer"]) {
  return signToken({ sub: "user-grant-001", tid: TENANT, roles, sid: "sess-004" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/grants/grants", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/grants",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/grants/grantees", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/grantees",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/grants/releases", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/releases",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/grants/installments (no appId)", () => {
  it("returns 200 with data array for tenant-wide listing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/installments",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("GET /v1/grants/utilization-certs", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/utilization-certs",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/grants/grants/:id — not found", () => {
  it("returns 404 for unknown grant id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/grants/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("unauthenticated", () => {
  it("GET /v1/grants/grants without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/grants/grants" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("wrong role", () => {
  it("GET /v1/grants/grants with unprivileged role → 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/grants/grants",
      headers: { authorization: `Bearer ${makeToken(["billing_viewer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
