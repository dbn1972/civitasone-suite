/**
 * Users routes — route inject tests.
 *
 * Covers: /identity/users (CRUD), /identity/users/:id/status,
 *         /identity/users/:id/keycloak-reconcile
 *
 * Auth boundary, validation, not-found, and happy paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const TENANT2 = "bbbbbbbb-2222-4000-8000-000000000099";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
const headers = (roles?: string[], tid?: string, sub?: string) => ({
  authorization: `Bearer ${token(roles, tid, sub)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("Users routes — auth boundary", () => {
  it("GET /identity/users → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/users" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /identity/users → 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/users", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/users → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      payload: { email: "test@test.gov.in", name: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/users → 403 for employee role", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      headers: headers(["employee"]),
      payload: { email: "test@test.gov.in", name: "Test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /identity/users/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/identity/users/${ACTOR}` });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /identity/users/:id → 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/identity/users/${ACTOR}`,
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /identity/users/:id → 403 for employee", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/identity/users/${ACTOR}`,
      headers: headers(["employee"]),
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /identity/users/:id/status → 401 without token", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/identity/users/${ACTOR}/status`,
      payload: { status: "suspended" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /identity/users/:id/status → 403 for employee", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/identity/users/${ACTOR}/status`,
      headers: headers(["employee"]),
      payload: { status: "suspended" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /identity/users/:id → 401 without token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/identity/users/${ACTOR}` });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /identity/users/:id → 403 for employee", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/identity/users/${ACTOR}`,
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/users/:id/keycloak-reconcile → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: `/identity/users/${ACTOR}/keycloak-reconcile`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/users/:id/keycloak-reconcile → 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: `/identity/users/${ACTOR}/keycloak-reconcile`,
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Users routes — not found (404)", () => {
  it("GET /identity/users/:id for unknown → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/identity/users/99999999-9999-4000-8000-999999999999",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("POST /identity/users/:id/keycloak-reconcile for unknown → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/identity/users/99999999-9999-4000-8000-999999999999/keycloak-reconcile",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Users routes — validation (400)", () => {
  it("GET /identity/users/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/identity/users/not-a-uuid",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /identity/users with missing email → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      headers: headers(["super_admin"]),
      payload: { name: "No Email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /identity/users/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/identity/users/not-a-uuid",
      headers: headers(["super_admin"]),
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Users routes — happy paths", () => {
  it("GET /identity/users → 200 with user list (array)", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/users", headers: headers(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /identity/users → 202 for valid creation", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      headers: headers(["super_admin"]),
      payload: { email: `user-${Date.now()}@coverage.gov.in`, name: "Coverage User" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("GET /identity/users/:id for self (employee) → 200 or 404", async () => {
    // An employee can read their own record. May be 404 if actor doesn't exist in DB.
    const res = await app.inject({
      method: "GET",
      url: `/identity/users/${ACTOR}`,
      headers: headers(["employee"], TENANT, ACTOR),
    });
    expect([200, 404]).toContain(res.statusCode);
  });

  it("GET /identity/users with cross-tenant as employee → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/users?tenantId=${TENANT2}`,
      headers: headers(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("GET /identity/users with cross-tenant as super_admin → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/users?tenantId=${TENANT2}`,
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });
});
