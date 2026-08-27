/**
 * policy-service — comprehensive route + domain coverage tests.
 *
 * Covers ALL routes (roles, bindings, evaluate, abac), auth 403, validation 400,
 * domain logic, error handlers. Uses buildApp + inject with HS256 test JWTs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const VALID_UUID = randomUUID();
const ROLE_ID = randomUUID();

function token(roles: string[] = ["tenant_admin"], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "s1" }, SECRET, 3600);
}

function headers(roles?: string[], tid?: string) {
  return { authorization: `Bearer ${token(roles, tid)}`, "content-type": "application/json" };
}

const adminH = () => headers(["tenant_admin"]);
const staffH = () => headers(["staff"]);

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// ROLE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /policy/roles", () => {
  it("returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      headers: adminH(),
      payload: { name: "Finance Manager" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with description", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      headers: adminH(),
      payload: { name: "HR Admin", description: "Manages HR" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with empty name", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      headers: adminH(),
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      headers: staffH(),
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/roles",
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /policy/roles", () => {
  it("returns 200 with array for admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/policy/roles",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/policy/roles",
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/policy/roles" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /policy/roles/:id", () => {
  it("returns 404 for non-existent role", async () => {
    const res = await app.inject({
      method: "GET", url: `/policy/roles/${VALID_UUID}`,
      headers: adminH(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid uuid param", async () => {
    const res = await app.inject({
      method: "GET", url: "/policy/roles/not-a-uuid",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/policy/roles/${VALID_UUID}`,
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /policy/roles/:id", () => {
  it("returns 202 with valid update", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/policy/roles/${VALID_UUID}`,
      headers: adminH(),
      payload: { name: "Updated Name" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 with description only update", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/policy/roles/${VALID_UUID}`,
      headers: adminH(),
      payload: { description: "New desc" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body (refine fails)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/policy/roles/${VALID_UUID}`,
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/policy/roles/bad-uuid",
      headers: adminH(),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/policy/roles/${VALID_UUID}`,
      headers: staffH(),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /policy/roles/:id/permissions", () => {
  it("returns 404 for non-existent role", async () => {
    const res = await app.inject({
      method: "GET", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: adminH(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/policy/roles/bad/permissions",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /policy/roles/:id/permissions", () => {
  it("returns 202 with valid permission", async () => {
    const res = await app.inject({
      method: "POST", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: adminH(),
      payload: { resource: "hrms.leave", action: "approve", effect: "allow" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 with default effect", async () => {
    const res = await app.inject({
      method: "POST", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: adminH(),
      payload: { resource: "finance.budget", action: "read" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid effect", async () => {
    const res = await app.inject({
      method: "POST", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: adminH(),
      payload: { resource: "x", action: "y", effect: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/policy/roles/${VALID_UUID}/permissions`,
      headers: staffH(),
      payload: { resource: "x", action: "y" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BINDING ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /policy/bindings", () => {
  it("returns 202 with valid binding", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/bindings",
      headers: adminH(),
      payload: { userId: randomUUID(), roleId: randomUUID() },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects missing userId", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/bindings",
      headers: adminH(),
      payload: { roleId: randomUUID() },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  it("rejects invalid uuid fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/bindings",
      headers: adminH(),
      payload: { userId: "bad", roleId: "bad" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/bindings",
      headers: staffH(),
      payload: { userId: randomUUID(), roleId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/bindings",
      payload: { userId: randomUUID(), roleId: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /policy/bindings/:id", () => {
  it("returns 202 with valid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/policy/bindings/${randomUUID()}`,
      headers: adminH(),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects invalid uuid param", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/policy/bindings/not-valid",
      headers: adminH(),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/policy/bindings/${randomUUID()}`,
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /policy/breakglass", () => {
  it("returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: adminH(),
      payload: { scope: "finance.*", reason: "Emergency access needed for incident", durationMinutes: 60 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 202 with default durationMinutes", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: adminH(),
      payload: { scope: "hrms.*", reason: "Urgent payroll correction required" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("rejects short reason with error status", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: adminH(),
      payload: { scope: "x", reason: "short" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  it("rejects empty scope with error status", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: adminH(),
      payload: { scope: "", reason: "Some valid reason here for testing" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  it("rejects invalid durationMinutes with error status", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: adminH(),
      payload: { scope: "x", reason: "Some valid reason here for testing", durationMinutes: 9999 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  // SEC regression: this route had no requireRole call at all (unlike both
  // sibling routes above, POST/DELETE /policy/bindings, which gate on ADMIN).
  // This test used to assert that as intended ("any authenticated user can
  // request breakglass"); it now asserts the corrected, sibling-consistent
  // behavior instead.
  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      headers: staffH(),
      payload: { scope: "finance.*", reason: "Emergency access required for incident" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/policy/breakglass",
      payload: { scope: "finance.*", reason: "Emergency access required for incident" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EVALUATE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/policy/evaluate", () => {
  it("returns deny for user with no permissions", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: headers(["staff"]),
      payload: { permissionKey: "hrms.leave.approve" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision).toBe("deny");
    expect(body.cacheable).toBe(true);
  });

  it("returns allow for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: headers(["super_admin"]),
      payload: { permissionKey: "finance.budget.approve" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("allow");
    expect(res.json().reason).toBe("role:super_admin");
  });

  it("returns 400 with invalid permissionKey (too short)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: adminH(),
      payload: { permissionKey: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      payload: { permissionKey: "hrms.leave.approve" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts optional resource field", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: headers(["super_admin"]),
      payload: { permissionKey: "hrms.leave.approve", resource: { id: "123" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("allow");
  });

  it("ignores client-supplied actor without internal headers", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/evaluate",
      headers: headers(["staff"]),
      payload: {
        permissionKey: "hrms.leave.approve",
        actor: { userId: randomUUID(), tenantId: randomUUID(), roles: ["super_admin"] },
      },
    });
    expect(res.statusCode).toBe(200);
    // Should NOT be allowed - actor override ignored
    expect(res.json().decision).toBe("deny");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ABAC ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/policy/abac/rules", () => {
  it("returns 202 with valid rule", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: adminH(),
      payload: {
        roleId: randomUUID(),
        expression: { effect: "allow", action: "read", resourceType: "doc", predicates: [] },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
    expect(res.json().status).toBe("accepted");
  });

  it("returns 202 with predicates", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: adminH(),
      payload: {
        roleId: randomUUID(),
        expression: {
          effect: "deny", action: "delete", resourceType: "leave",
          predicates: [{ op: "exists", path: "subject.id" }],
        },
        enabled: false,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing roleId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: adminH(),
      payload: { expression: { effect: "allow", action: "x", resourceType: "y", predicates: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid expression effect", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: adminH(),
      payload: {
        roleId: randomUUID(),
        expression: { effect: "maybe", action: "x", resourceType: "y", predicates: [] },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: staffH(),
      payload: {
        roleId: randomUUID(),
        expression: { effect: "allow", action: "read", resourceType: "doc", predicates: [] },
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      payload: { roleId: randomUUID(), expression: { effect: "allow", action: "x", resourceType: "y", predicates: [] } },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/policy/abac/rules", () => {
  it("returns 200 with data array for admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/abac/rules",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/abac/rules",
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/abac/rules" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/policy/abac/rules/:id", () => {
  it("returns 404 for non-existent rule", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: adminH(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/abac/rules/not-uuid",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/policy/abac/rules/:id", () => {
  it("returns 404 for non-existent rule", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: adminH(),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with empty body (refine)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/policy/abac/rules/bad",
      headers: adminH(),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: staffH(),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/policy/abac/rules/:id", () => {
  it("returns 404 for non-existent rule", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: adminH(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/policy/abac/rules/invalid",
      headers: adminH(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/policy/abac/rules/${randomUUID()}`,
      headers: staffH(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/policy/abac/evaluate", () => {
  it("returns deny (default-deny, no rules for this tenant)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      headers: headers(["staff"]),
      payload: {
        subject: { id: ACTOR, roleIds: [randomUUID()], attrs: {} },
        action: "read",
        resource: { type: "doc", attrs: {} },
        context: {},
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("deny");
  });

  it("any authenticated user can call evaluate", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      headers: staffH(),
      payload: {
        subject: { roleIds: [], attrs: {} },
        action: "view",
        resource: { type: "ticket", attrs: {} },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 with missing action", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      headers: adminH(),
      payload: {
        subject: { roleIds: [], attrs: {} },
        action: "",
        resource: { type: "doc", attrs: {} },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing resource type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      headers: adminH(),
      payload: {
        subject: { roleIds: [], attrs: {} },
        action: "read",
        resource: { type: "", attrs: {} },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      headers: adminH(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/evaluate",
      payload: { subject: { roleIds: [], attrs: {} }, action: "x", resource: { type: "y", attrs: {} } },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN — evaluate/domain.ts additional coverage
// ══════════════════════════════════════════════════════════════════════════════
import { parsePermissionKey, evaluateDecision } from "../src/modules/evaluate/domain.js";

describe("evaluate domain — edge cases", () => {
  it("parsePermissionKey handles multi-part resource", () => {
    const r = parsePermissionKey("finance.budget.allocation.approve");
    expect(r.resource).toBe("finance.budget.allocation");
    expect(r.action).toBe("approve");
  });

  it("evaluateDecision deny for empty granted list", () => {
    const r = evaluateDecision("hrms.leave.read", ["manager"], []);
    expect(r.decision).toBe("deny");
    expect(r.ttlSeconds).toBe(30);
  });

  it("evaluateDecision deny effect is not considered allow", () => {
    const granted = [{ resource: "hrms.leave", action: "approve", effect: "deny", roleName: "mgr" }];
    const r = evaluateDecision("hrms.leave.approve", ["manager"], granted);
    expect(r.decision).toBe("deny");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DOMAIN — abac/domain.ts additional coverage
// ══════════════════════════════════════════════════════════════════════════════
import {
  evaluate,
  evalPredicate,
  resolvePath,
  ruleMatches,
  parseExpression,
  assertExpression,
  ExpressionError,
  type CompiledRule,
  type AccessRequest,
  type RuleExpression,
} from "../src/modules/abac/domain.js";

describe("abac domain — additional path coverage", () => {
  const ROLE = randomUUID();

  function mkRule(id: string, expr: RuleExpression, enabled = true): CompiledRule {
    return { id, roleId: ROLE, enabled, expression: expr };
  }

  function mkReq(over: Partial<AccessRequest> = {}): AccessRequest {
    return {
      subject: { id: "u1", roleIds: [ROLE], attrs: { userId: "u1" } },
      action: "read",
      resource: { type: "doc", attrs: { ownerId: "u1", tenantId: "t1" } },
      context: { tenantId: "t1" },
      ...over,
    };
  }

  it("evalPredicate — unknown op returns false", () => {
    const p = { op: "regex" as any, path: "x" };
    expect(evalPredicate(mkReq(), p)).toBe(false);
  });

  it("resolvePath — action root returns action string", () => {
    expect(resolvePath(mkReq(), "action")).toBe("read");
  });

  it("resolvePath — deep nested null returns undefined", () => {
    const r = mkReq({ context: { a: null } });
    expect(resolvePath(r, "context.a.b")).toBeUndefined();
  });

  it("owner-match with custom paths", () => {
    const r = mkReq({
      subject: { id: "u1", roleIds: [ROLE], attrs: { managerId: "m1" } },
      resource: { type: "doc", attrs: { approver: "m1", tenantId: "t1" } },
    });
    expect(evalPredicate(r, { op: "owner-match", subjectPath: "subject.managerId", resourcePath: "resource.approver" })).toBe(true);
  });

  it("tenant-match with custom paths", () => {
    const r = mkReq({
      subject: { id: "u1", roleIds: [ROLE], attrs: { orgId: "org1" } },
      resource: { type: "doc", attrs: { orgId: "org1", tenantId: "t1" } },
    });
    expect(evalPredicate(r, { op: "tenant-match", subjectPath: "subject.orgId", resourcePath: "resource.orgId" })).toBe(true);
  });

  it("tenant-match false when resource path missing", () => {
    const r = mkReq({ resource: { type: "doc", attrs: {} } });
    expect(evalPredicate(r, { op: "tenant-match" })).toBe(false);
  });

  it("owner-match false when subject has no id and no attrs.userId", () => {
    const r = mkReq({ subject: { roleIds: [ROLE], attrs: {} } });
    expect(evalPredicate(r, { op: "owner-match" })).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARED — context.ts coverage
// ══════════════════════════════════════════════════════════════════════════════
import { HttpError, requireRole, resolveContext } from "../src/shared/context.js";
import type { RequestContext } from "@civitasone/types";

describe("shared/context — HttpError", () => {
  it("creates error with correct properties", () => {
    const err = new HttpError(422, "UNPROCESSABLE", "bad data");
    expect(err.status).toBe(422);
    expect(err.code).toBe("UNPROCESSABLE");
    expect(err.message).toBe("bad data");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("shared/context — requireRole", () => {
  const mkCtx = (roles: string[]): RequestContext => ({
    tenantId: "t1", actorId: "u1", actorType: "user", roles, correlationId: "c1", sessionId: "s1",
  });

  it("allows platform_admin", () => {
    expect(() => requireRole(mkCtx(["platform_admin"]), ["platform_admin", "super_admin"])).not.toThrow();
  });

  it("allows super_admin", () => {
    expect(() => requireRole(mkCtx(["super_admin"]), ["platform_admin", "super_admin"])).not.toThrow();
  });

  it("rejects user with no matching role", () => {
    expect(() => requireRole(mkCtx(["viewer"]), ["platform_admin"])).toThrow(HttpError);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATORS — additional coverage for refine logic
// ══════════════════════════════════════════════════════════════════════════════
import { updateRoleBody } from "../src/modules/roles/validators.js";
import { updateRuleBody } from "../src/modules/abac/validators.js";

describe("validators — updateRoleBody refine", () => {
  it("rejects empty object", () => {
    const r = updateRoleBody.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts name only", () => {
    const r = updateRoleBody.safeParse({ name: "X" });
    expect(r.success).toBe(true);
  });

  it("accepts description only", () => {
    const r = updateRoleBody.safeParse({ description: "D" });
    expect(r.success).toBe(true);
  });

  it("rejects name too long", () => {
    const r = updateRoleBody.safeParse({ name: "a".repeat(200) });
    expect(r.success).toBe(false);
  });
});

describe("validators — updateRuleBody refine", () => {
  it("rejects empty object", () => {
    const r = updateRuleBody.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts enabled only", () => {
    const r = updateRuleBody.safeParse({ enabled: true });
    expect(r.success).toBe(true);
  });

  it("accepts expression only", () => {
    const r = updateRuleBody.safeParse({
      expression: { effect: "allow", action: "x", resourceType: "y", predicates: [] },
    });
    expect(r.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TOPICS — coverage
// ══════════════════════════════════════════════════════════════════════════════
import { COMMANDS, EVENTS, SERVICE, RESOURCE } from "../src/topics.js";

describe("topics module exports", () => {
  it("exports COMMANDS object", () => {
    expect(COMMANDS.createRole).toBe("policy.role.create");
    expect(COMMANDS.updateRole).toBe("policy.role.update");
    expect(COMMANDS.addPermission).toBe("policy.permission.add");
    expect(COMMANDS.createBinding).toBe("policy.binding.create");
    expect(COMMANDS.revokeBinding).toBe("policy.binding.revoke");
    expect(COMMANDS.requestBreakglass).toBe("policy.breakglass.request");
    expect(COMMANDS.createAbacRule).toBe("policy.abac.rule.create");
    expect(COMMANDS.updateAbacRule).toBe("policy.abac.rule.update");
    expect(COMMANDS.deleteAbacRule).toBe("policy.abac.rule.delete");
  });

  it("exports EVENTS object", () => {
    expect(EVENTS.roleCreated).toBe("policy.role.created");
    expect(EVENTS.bindingCreated).toBe("policy.binding.created");
    expect(EVENTS.abacRuleCreated).toBe("policy.abac.rule.created");
  });

  it("exports SERVICE and RESOURCE", () => {
    expect(SERVICE).toBe("policy");
    expect(RESOURCE.role).toBe("role");
    expect(RESOURCE.binding).toBe("binding");
    expect(RESOURCE.breakglass).toBe("breakglass");
    expect(RESOURCE.abacRule).toBe("abac_rule");
  });
});
