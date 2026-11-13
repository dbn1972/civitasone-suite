/**
 * Role governance (pure): the allow-list, the platform-role refusals, the "you cannot grant what you do not
 * hold" rule for admin-tier roles, and the default role.
 */
import { describe, it, expect } from "vitest";
import {
  checkGrant, effectiveCreateRoles, isTenantGrantable, normaliseRoles, DEFAULT_ROLE,
  PLATFORM_ROLES, STAFF_ROLES, ADMIN_TIER_ROLES,
} from "../src/modules/users/grantable-roles.js";

const TENANT_ADMIN = ["tenant_admin"];
const BOOTSTRAP_ADMIN = ["tenant_admin", "hr_admin", "finance_admin", "payroll_admin", "procurement_admin"];

describe("allow-list", () => {
  it("the default role is employee and is the fallback when none are given", () => {
    expect(DEFAULT_ROLE).toBe("employee");
    expect(effectiveCreateRoles(undefined)).toEqual(["employee"]);
    expect(effectiveCreateRoles([])).toEqual(["employee"]);
    expect(effectiveCreateRoles(["manager", "manager"])).toEqual(["manager"]);
  });

  it("no platform role is ever tenant-grantable, and the two sets do not overlap", () => {
    for (const r of PLATFORM_ROLES) expect(isTenantGrantable(r)).toBe(false);
    for (const r of [...STAFF_ROLES, ...ADMIN_TIER_ROLES]) expect((PLATFORM_ROLES as readonly string[]).includes(r)).toBe(false);
  });

  it.each(["super_admin", "platform_admin", "tenant_admin", "admin", "service_account", "security_admin", "audit_admin", "citizen"])(
    "%s is refused as a platform / governance role for EVERY caller, platform callers included", (role) => {
      for (const caller of [TENANT_ADMIN, ["platform_admin"], ["super_admin"], BOOTSTRAP_ADMIN]) {
        const r = checkGrant(caller, [role]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.refused[0]!.code).toBe("PLATFORM_ROLE");
      }
    });

  it("an unknown or malformed role is refused as not grantable", () => {
    for (const bad of ["made_up_role", "", "EMPLOYEE", "employee ", "../admin"]) {
      const r = checkGrant(TENANT_ADMIN, [bad]);
      // "employee " is trimmed by normalisation and so is valid; the rest are not.
      if (bad === "employee ") expect(r.ok).toBe(true);
      else expect(r.ok).toBe(false);
    }
  });

  it("staff roles are grantable by a tenant admin", () => {
    const r = checkGrant(TENANT_ADMIN, ["employee", "manager", "hr_officer"]);
    expect(r).toEqual({ ok: true, roles: ["employee", "manager", "hr_officer"] });
  });
});

describe("privilege escalation", () => {
  it("a caller cannot grant an admin-tier role they do not hold", () => {
    const r = checkGrant(TENANT_ADMIN, ["hr_admin"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused[0]!.code).toBe("CALLER_LACKS_ROLE");
  });

  it("a caller can grant an admin-tier role they hold, but not one they do not", () => {
    expect(checkGrant(BOOTSTRAP_ADMIN, ["hr_admin"]).ok).toBe(true);
    expect(checkGrant(BOOTSTRAP_ADMIN, ["works_admin"]).ok).toBe(false);
  });

  it("platform callers may grant admin-tier roles for the tenant, but still no platform role", () => {
    expect(checkGrant(["platform_admin"], ["works_admin", "hr_admin"]).ok).toBe(true);
    expect(checkGrant(["super_admin"], ["super_admin"]).ok).toBe(false);
  });

  it("is all-or-nothing: one refused role refuses the whole request", () => {
    const r = checkGrant(TENANT_ADMIN, ["employee", "manager", "super_admin"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refused.map((x) => x.role)).toEqual(["super_admin"]);
  });

  it("normalisation cannot be used to smuggle a role past the check", () => {
    expect(normaliseRoles([" super_admin", "super_admin"])).toEqual(["super_admin"]);
    expect(checkGrant(TENANT_ADMIN, [" super_admin"]).ok).toBe(false);
  });
});
