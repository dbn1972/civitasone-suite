/**
 * Keycloak realm role catalog — policy-service seed for the 7 real roles
 * this platform's Keycloak realm issues (Phase 1b RBAC remediation).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { KEYCLOAK_REALM_ROLE_CATALOG, listKeycloakRoleNames } from "../src/modules/roles/keycloak-catalog.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";

function token(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: "00000000-cccc-4000-8000-000000000002", tid: TENANT, roles, sid: "sess-kc" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("keycloak realm role catalog", () => {
  it("lists exactly the 7 real Keycloak realm roles", () => {
    expect(listKeycloakRoleNames()).toEqual(
      ["auditor", "citizen", "dept_head", "officer", "service_account", "super_admin", "tenant_admin"].sort(),
    );
  });

  it("seeds zero permissions for super_admin (evaluator already special-cases it)", () => {
    const superAdmin = KEYCLOAK_REALM_ROLE_CATALOG.find((r) => r.name === "super_admin");
    expect(superAdmin?.permissions).toEqual([]);
  });

  it("seeds zero permissions for citizen and service_account", () => {
    for (const name of ["citizen", "service_account"]) {
      const stub = KEYCLOAK_REALM_ROLE_CATALOG.find((r) => r.name === name);
      expect(stub?.permissions, `${name} should start with no permissions`).toEqual([]);
    }
  });

  it("seeds a non-empty starter permission set for tenant_admin, dept_head, officer, auditor", () => {
    for (const name of ["tenant_admin", "dept_head", "officer", "auditor"]) {
      const stub = KEYCLOAK_REALM_ROLE_CATALOG.find((r) => r.name === name);
      expect(stub?.permissions.length ?? 0, `${name} should have a starter permission set`).toBeGreaterThan(0);
    }
  });

  it("every seeded permission key has at least 3 dot-separated segments (parsePermissionKey requirement)", () => {
    for (const stub of KEYCLOAK_REALM_ROLE_CATALOG) {
      for (const perm of stub.permissions) {
        expect(perm.split(".").length, `${stub.name}: "${perm}"`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("GET /policy/roles/catalog/keycloak", () => {
  it("returns catalog for super_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/policy/roles/catalog/keycloak",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { roleCount: number } };
    expect(body.data).toHaveLength(7);
    expect(body.meta.roleCount).toBe(7);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/policy/roles/catalog/keycloak",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /policy/roles/provision/keycloak", () => {
  it("returns 202 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/roles/provision/keycloak",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; correlationId: string };
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeTruthy();
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/policy/roles/provision/keycloak",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
