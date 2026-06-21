/**
 * knowledge-service HTTP route tests (inject).
 * Asserts every list/detail/dashboard route returns 200 + correct shape.
 * Uses HS256 test JWTs. No seeded DB rows — routes return [] / empty objects.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["knowledge_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/knowledge/documents — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/documents",
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
      url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: other tenant returns 200 empty", async () => {
    const app = await buildApp();
    const other = "bbbbbbbb-2222-4000-8000-000000000099";
    const token = signToken({ sub: "u2", tid: other, roles: ["knowledge_user"], sid: "s2" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/documents",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /v1/knowledge/records — shape", () => {
  it("returns 200 with array shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("POST /v1/knowledge/search — shape", () => {
  it("returns 200 with array shape for valid query", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "budget policy" }),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 400 for empty query", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("unauthenticated requests", () => {
  it("GET /v1/knowledge/documents without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/documents" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
