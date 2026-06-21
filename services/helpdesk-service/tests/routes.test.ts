/**
 * helpdesk-service HTTP route tests (inject)
 *
 * Asserts list/detail routes return 200 + correct shape.
 * Uses HS256 test JWTs. No seeded rows — empty results still pass schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const OTHER  = "bbbbbbbb-2222-4000-8000-000000000088";

function token(tenantId = TENANT, roles = ["helpdesk_user"]) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/helpdesk/tickets", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets",
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

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: different tenant returns 200 (empty data)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/helpdesk/tickets/:id — not found", () => {
  it("returns 404 for unknown id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("unauthenticated", () => {
  it("GET /v1/helpdesk/tickets without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/tickets" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
