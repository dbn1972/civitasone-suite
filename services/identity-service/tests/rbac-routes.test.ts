/**
 * RBAC routes — route inject tests.
 *
 * Covers: /identity/rbac/roles, /identity/rbac/permissions,
 *         /identity/rbac/roles/:id/permissions, /identity/rbac/roles/:id/assignments,
 *         /identity/rbac/users/:userId/effective
 *
 * Auth boundary (401, 403), validation (400), not-found (404), and 202 happy paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
const headers = (roles?: string[], tid?: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("RBAC routes — auth boundary", () => {
  it("GET /identity/rbac/roles → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/roles" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /identity/rbac/roles → 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/roles", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("GET /identity/rbac/permissions → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/permissions" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /identity/rbac/permissions → 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/permissions", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/rbac/roles → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/rbac/roles", payload: { key: "test.role", name: "Test" } });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/rbac/roles → 403 for employee", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/rbac/roles", headers: headers(["employee"]), payload: { key: "test.role", name: "Test" } });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/rbac/permissions → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/rbac/permissions", payload: { key: "test.perm", name: "Test" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("RBAC routes — validation (400)", () => {
  it("POST /identity/rbac/roles with invalid key format → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles",
      headers: headers(["super_admin"]),
      payload: { key: "INVALID KEY", name: "Bad" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("POST /identity/rbac/roles with empty name → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles",
      headers: headers(["super_admin"]),
      payload: { key: "valid.key", name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /identity/rbac/permissions with empty key → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/permissions",
      headers: headers(["super_admin"]),
      payload: { key: "", name: "Some perm" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /identity/rbac/roles/:id/permissions with non-uuid permissionId → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/identity/rbac/roles/11111111-1111-4000-8000-000000000001/permissions",
      headers: headers(["super_admin"]),
      payload: { permissionId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /identity/rbac/roles/:id/assignments with non-uuid userId → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/identity/rbac/roles/11111111-1111-4000-8000-000000000001/assignments",
      headers: headers(["super_admin"]),
      payload: { userId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /identity/rbac/roles/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/identity/rbac/roles/bad-id",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("RBAC routes — not found (404)", () => {
  it("GET /identity/rbac/roles/:id for unknown → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/identity/rbac/roles/99999999-9999-4000-8000-999999999999",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("RBAC routes — reserved key protection (SEC C2)", () => {
  it("POST /identity/rbac/roles with reserved key as tenant_admin → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles",
      headers: headers(["tenant_admin"]),
      payload: { key: "super_admin", name: "Escalation attempt" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("POST /identity/rbac/permissions with system.secret key as tenant_admin → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/permissions",
      headers: headers(["tenant_admin"]),
      payload: { key: "system.secret", name: "Escalation attempt" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /identity/rbac/roles with reserved key as super_admin → 202 (allowed)", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles",
      headers: headers(["super_admin"]),
      payload: { key: "platform.special", name: "Platform role" },
    });
    // super_admin has unconditional authority — will publish or 409 if already exists
    expect([202, 409]).toContain(res.statusCode);
  });
});

describe("RBAC routes — happy paths", () => {
  it("GET /identity/rbac/roles with admin → 200 array", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/roles", headers: headers(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /identity/rbac/permissions with admin → 200 array", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/rbac/permissions", headers: headers(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("POST /identity/rbac/roles → 202 accepted for valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles",
      headers: headers(["super_admin"]),
      payload: { key: "test.rbac.routes.role", name: "Test Coverage Role" },
    });
    // 202 or 409 if already exists from prior run
    expect([202, 409]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
    }
  });

  it("POST /identity/rbac/permissions → 202 accepted for valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/permissions",
      headers: headers(["super_admin"]),
      payload: { key: "test.rbac.routes.perm", name: "Test Coverage Permission" },
    });
    expect([202, 409]).toContain(res.statusCode);
  });

  it("GET /identity/rbac/roles with limit and offset → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/identity/rbac/roles?limit=5&offset=0",
      headers: headers(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /identity/rbac/users/:userId/effective → 200 for self", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/identity/rbac/users/${ACTOR}/effective`,
      headers: headers(["employee"], TENANT, ACTOR),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe(ACTOR);
    expect(body.tenantId).toBe(TENANT);
    expect(body).toHaveProperty("roles");
    expect(body).toHaveProperty("permissions");
  });

  it("GET /identity/rbac/users/:userId/effective → 403 for non-self non-admin", async () => {
    const otherUser = "b9999999-9999-4000-8000-000000000099";
    const res = await app.inject({
      method: "GET",
      url: `/identity/rbac/users/${otherUser}/effective`,
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
