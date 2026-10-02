/**
 * policy-service — role-feature grant/revoke authority (a tenant_admin cannot
 * hand out admin or platform features it does not hold).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { RESTRICTED_FEATURE_PREFIXES, isPlatformFeature, mayManageFeature } from "../src/modules/role-features/authority.js";

const held = vi.hoisted(() => ({ features: new Set<string>(), grantKey: null as string | null }));
vi.mock("../src/modules/role-features/authorize.js", async () => {
  const real = await vi.importActual<typeof import("../src/modules/role-features/authorize.js")>("../src/modules/role-features/authorize.js");
  const auth = await import("../src/modules/role-features/authority.js");
  const { HttpError } = await import("../src/shared/context.js");
  return {
    ...real,
    findGrantFeatureKey: async () => held.grantKey,
    assertMayManageFeature: async (ctx: { roles: string[] }, key: string) => {
      if (!auth.mayManageFeature(ctx.roles, key, held.features)) throw new HttpError(403, "FEATURE_AUTHORITY", "no");
    },
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
const GRANT = "11111111-cccc-4000-8000-333333333333";
const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}` });

describe("authority rules (pure)", () => {
  it("pins the restricted namespace list (changing it is a security decision)", () => {
    expect([...RESTRICTED_FEATURE_PREFIXES]).toEqual([
      "admin.", "platform.", "system.", "rbac.", "tenant.", "identity.", "iam.", "security.", "policy.",
      "billing.admin", "billing.subscriptions", "billing.plans",
    ]);
  });
  it("restricts every privileged key found in source, but not ordinary module features", () => {
    for (const k of ["rbac.admin", "tenant.users", "tenant.settings", "tenant.subscriptions", "tenant.tenant_configs", "admin.platform_config", "admin.plans", "admin.domains", "policy.roles.write", "identity.users", "billing.admin"]) {
      expect(isPlatformFeature(k), k).toBe(true);
    }
    for (const k of ["finance.vouchers", "hrms.leave", "procurement.vendors", "tenants.read", "billing.invoices", "projects.manage"]) {
      expect(isPlatformFeature(k), k).toBe(false);
    }
  });
  it("derives the platform namespace from the feature key", () => {
    expect(isPlatformFeature("admin.users")).toBe(true);
    expect(isPlatformFeature("PLATFORM.billing")).toBe(true);
    expect(isPlatformFeature("finance.vouchers")).toBe(false);
  });
  it("platform callers may manage anything; others only what they hold", () => {
    expect(mayManageFeature(["super_admin"], "admin.users", new Set())).toBe(true);
    expect(mayManageFeature(["tenant_admin"], "finance.vouchers", new Set())).toBe(true);
    expect(mayManageFeature(["tenant_admin"], "admin.users", new Set())).toBe(false);
    expect(mayManageFeature(["tenant_admin"], "admin.users", new Set(["admin.users"]))).toBe(true);
  });
});

describe("role-feature write authority (routes)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); await sqlClient.end().catch(() => undefined); });
  beforeEach(() => { held.features = new Set(); held.grantKey = null; });

  it("403 when a tenant_admin grants admin.users it does not hold", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["tenant_admin"]), payload: { roleName: "hr_admin", featureKey: "admin.users" } });
    expect(res.statusCode).toBe(403);
  });
  it("403 when a tenant_admin revokes an admin.* grant it does not hold", async () => {
    held.grantKey = "admin.settings";
    const res = await app.inject({ method: "DELETE", url: `/v1/policy/role-features/${GRANT}`, headers: hdr(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
  it.each(["rbac.admin", "tenant.users"])("403 when a tenant_admin grants %s it does not hold", async (featureKey) => {
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["tenant_admin"]), payload: { roleName: "hr_admin", featureKey } });
    expect(res.statusCode).toBe(403);
  });
  it.each(["rbac.admin", "tenant.users"])("a super_admin may grant %s (202)", async (featureKey) => {
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["super_admin"]), payload: { roleName: "hr_admin", featureKey } });
    expect(res.statusCode).toBe(202);
  });
  it.each(["rbac.admin", "tenant.users"])("a tenant_admin who holds %s may grant it (202)", async (featureKey) => {
    held.features = new Set([featureKey]);
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["tenant_admin"]), payload: { roleName: "hr_admin", featureKey } });
    expect(res.statusCode).toBe(202);
  });
  it("a tenant_admin may grant an ordinary feature (202)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["tenant_admin"]), payload: { roleName: "hr_admin", featureKey: "hrms.leave" } });
    expect(res.statusCode).toBe(202);
  });
  it("a tenant_admin who holds admin.users may grant it (202)", async () => {
    held.features = new Set(["admin.users"]);
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["tenant_admin"]), payload: { roleName: "hr_admin", featureKey: "admin.users" } });
    expect(res.statusCode).toBe(202);
  });
  it("a super_admin may grant admin.users (202)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/policy/role-features", headers: hdr(["super_admin"]), payload: { roleName: "hr_admin", featureKey: "admin.users" } });
    expect(res.statusCode).toBe(202);
  });
  it("revoking an unknown grant id is 404 for a tenant_admin", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/policy/role-features/${GRANT}`, headers: hdr(["tenant_admin"]) });
    expect(res.statusCode).toBe(404);
  });
});
