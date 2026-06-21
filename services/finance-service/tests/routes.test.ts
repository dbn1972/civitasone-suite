/**
 * finance-service HTTP route tests (inject)
 *
 * Asserts every list/detail/dashboard route returns 200 + correct shape.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 * No seeded DB rows → routes return [] / empty objects, but schema validates.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["finance_officer"]) {
  return signToken(
    { sub: "user-001", tid: TENANT, roles, sid: "sess-001" },
    SECRET,
  );
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/finance/dashboard — shape", () => {
  it("returns 200 with dashboard shape", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.pendingSanctions).toBe("number");
    expect(typeof body.paymentsThisMonth).toBe("number");
  });
});

describe("GET /v1/finance/sanctions — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/sanctions",
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
      url: "/v1/finance/sanctions",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/finance/bills — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/bills",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/advances — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns 200 (empty)", async () => {
    const app = await buildApp();
    const otherTenant = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: otherTenant, roles: ["finance_officer"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /v1/finance/utilization-certificates — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/utilization-certificates",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/journals — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/journals",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("GET /v1/finance/statements — shape", () => {
  it("returns 200 with array or object shape", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/statements",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/finance/bills without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/bills" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
