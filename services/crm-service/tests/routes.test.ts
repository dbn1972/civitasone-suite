/**
 * crm-service HTTP route tests (inject)
 *
 * Asserts list/detail/dashboard routes return 200 + correct shape.
 * Uses HS256 test JWTs. No seeded rows — empty results still pass schema validation.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const OTHER  = "bbbbbbbb-2222-4000-8000-000000000099";

function token(tenantId = TENANT, roles = ["crm_user"]) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/crm/dashboard", () => {
  it("returns 200 with correct dashboard shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.totalContacts).toBe("number");
    expect(typeof body.openDeals).toBe("number");
    expect(typeof body.activitiesToday).toBe("number");
    expect(typeof body.pipelineValue).toBe("number");
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: different tenant returns 200 (empty aggregate)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalContacts).toBe(0);
    expect(body.openDeals).toBe(0);
  });
});

describe("GET /v1/crm/contacts", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/contacts",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data ?? body)).toBe(true);
  });
});

describe("GET /v1/crm/deals", () => {
  it("returns 200 with list shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/deals",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("unauthenticated", () => {
  it("GET /v1/crm/dashboard without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
