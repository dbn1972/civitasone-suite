/**
 * telephony-service HTTP route tests (fastify inject).
 *
 * Asserts auth (401/403), list/metrics shape (200), tenant isolation, and
 * validation rejection (400). Uses HS256 test JWTs. No seeded rows required —
 * empty results still satisfy the response schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const OTHER = "bbbbbbbb-2222-4000-8000-000000000099";

function token(tenantId = TENANT, roles = ["telephony_user"]) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("GET /v1/telephony/calls", () => {
  it("returns 200 with the paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
    expect(typeof body.pagination.hasMore).toBe("boolean");
    expect(typeof body.pagination.pageSize).toBe("number");
  });

  it("returns 403 for a wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: a different tenant sees empty data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("rejects an invalid status filter with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls?status=banana",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/telephony/calls — validation", () => {
  it("rejects an invalid phone number with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/calls",
      headers: { authorization: `Bearer ${token()}` },
      payload: { callerNumber: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/telephony/calls/metrics", () => {
  it("returns aggregate metrics", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls/metrics",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe("number");
    expect(typeof body.abandonmentRatePct).toBe("number");
    expect(typeof body.slaAnsweredPct).toBe("number");
  });
});

describe("GET /v1/telephony/calls/:id — not found", () => {
  it("returns 404 for an unknown id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/telephony/calls/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("unauthenticated", () => {
  it("GET /v1/telephony/calls without a token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/telephony/calls" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
