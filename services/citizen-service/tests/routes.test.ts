/**
 * citizen-service HTTP route tests (inject)
 *
 * Asserts key list/analytics routes return 200 + correct shape.
 * Uses HS256 test JWTs. No seeded rows — empty results still pass schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const OTHER  = "bbbbbbbb-2222-4000-8000-000000000077";

const ACTOR = "cccccccc-3333-4000-8000-000000000077";

function token(tenantId = TENANT, roles = ["citizen_officer"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/citizen/tickets/analytics", () => {
  it("returns 200 with analytics shape (registered BEFORE :id)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/tickets/analytics",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.totalTickets).toBe("number");
    expect(typeof body.openTickets).toBe("number");
    expect(typeof body.resolvedThisMonth).toBe("number");
    expect(typeof body.slaBreachedCount).toBe("number");
    expect(Array.isArray(body.byPriority)).toBe(true);
    expect(Array.isArray(body.byChannel)).toBe(true);
  });
});

describe("GET /v1/citizen/tickets — slaStatus=breached filter", () => {
  it("returns 200 with paginated shape when slaStatus=breached", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/tickets?slaStatus=breached",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
  });

  it("tenant isolation: different tenant returns empty data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/tickets",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/citizen/requests", () => {
  it("returns 200 with array of CitizenRequestSummary", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/requests",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns empty array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/requests",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("GET /v1/citizen/rti", () => {
  it("returns 200 with array of RTISummary", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/rti",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("tenant isolation: different tenant returns empty array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/rti",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("unauthenticated", () => {
  it("GET /v1/citizen/requests without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/citizen/requests" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
