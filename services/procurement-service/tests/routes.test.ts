/**
 * procurement-service HTTP route tests (inject)
 *
 * Asserts list/detail/dashboard routes return 200 + correct shape.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000099";

function makeToken(roles: string[] = ["procurement_officer"]) {
  return signToken({ sub: "user-proc-001", tid: TENANT, roles, sid: "sess-proc-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/procurement/dashboard — shape", () => {
  it("returns 200 with dashboard shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/dashboard",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.pendingIndents).toBe("number");
    expect(typeof body.activePOs).toBe("number");
  });
});

describe("GET /v1/procurement/grns — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/grns",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns 200 (empty)", async () => {
    const app = await buildApp();
    const otherTenant = "cccccccc-4444-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: otherTenant, roles: ["procurement_officer"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/grns",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/grns",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/procurement/rfqs — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/rfqs",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 404 for unknown RFQ detail", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/rfqs/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/procurement/tenders — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/tenders",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 404 for unknown tender detail", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/procurement/tenders/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/procurement/grns without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/procurement/grns" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
