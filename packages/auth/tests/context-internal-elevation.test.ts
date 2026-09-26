/**
 * Regression coverage for packages/auth/src/context.ts's resolveServiceContext(),
 * the fallback resolver used when a caller invokes it directly instead of relying on
 * req.ctx set by authPlugin (see context.ts's own doc comment: "Falls back to HS256
 * test tokens"). It carries its own, independent copy of the x-internal
 * service-to-service elevation logic — packages/auth/tests/internal-secret.test.ts
 * only exercises the authPlugin (plugin.ts) copy of that same logic, so this file
 * exercises the context.ts copy directly via a minimal fake FastifyRequest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "../src/context.js";

const SECRET = "context-ts-test-internal-secret-1234567890";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ORIGINAL_ENV = { ...process.env };

function fakeRequest(headers: Record<string, string>): FastifyRequest {
  return { headers, id: "test-request-id" } as unknown as FastifyRequest;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", INTERNAL_SERVICE_SECRET: SECRET };
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveServiceContext: x-internal elevation (context.ts fallback resolver)", () => {
  it("grants the real Keycloak realm roles on an exact secret match", () => {
    const req = fakeRequest({
      "x-internal": "1",
      "x-tenant-id": TENANT,
      "x-service-secret": SECRET,
    });
    const ctx = resolveServiceContext(req);
    expect(ctx.tenantId).toBe(TENANT);
    expect(ctx.actorType).toBe("service_account");

    // The 7 roles actually defined in infra/keycloak/civitasone-realm.json.
    const realRealmRoles = [
      "super_admin",
      "tenant_admin",
      "dept_head",
      "officer",
      "auditor",
      "citizen",
      "service_account",
    ];
    for (const role of realRealmRoles) {
      expect(ctx.roles).toContain(role);
    }
    expect(ctx.roles).toHaveLength(realRealmRoles.length);

    // Regression: must never reintroduce the fictional roles Keycloak never issues.
    for (const fictional of ["hr_admin", "payroll_admin", "finance_admin"]) {
      expect(ctx.roles).not.toContain(fictional);
    }
  });

  it("rejects x-internal with a wrong service secret", () => {
    const req = fakeRequest({
      "x-internal": "1",
      "x-tenant-id": TENANT,
      "x-service-secret": "wrong-secret-wrong-secret",
    });
    expect(() => resolveServiceContext(req)).toThrow(AuthContextError);
  });

  it("rejects x-internal with no service secret provided", () => {
    const req = fakeRequest({
      "x-internal": "1",
      "x-tenant-id": TENANT,
    });
    expect(() => resolveServiceContext(req)).toThrow(AuthContextError);
  });

  it("rejects x-internal entirely when no INTERNAL_SERVICE_SECRET is configured", () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const req = fakeRequest({
      "x-internal": "1",
      "x-tenant-id": TENANT,
      "x-service-secret": "anything",
    });
    expect(() => resolveServiceContext(req)).toThrow(AuthContextError);
  });

  it("falls through to the Bearer-token path (and rejects) without x-tenant-id, even with a correct secret", () => {
    const req = fakeRequest({
      "x-internal": "1",
      "x-service-secret": SECRET,
    });
    // No x-tenant-id means resolveServiceContextInner's x-internal branch condition
    // (`req.headers["x-internal"] === "1" && tenantHeader`) is false, so it falls through
    // to the Bearer-token path, which then correctly rejects for lack of a token.
    expect(() => resolveServiceContext(req)).toThrow(AuthContextError);
  });
});
