import { describe, it, expect } from "vitest";
import {
  ADMIN_PLATFORM_ROLES,
  API_CATALOGUE_ROLES,
  BILLING_INVOICE_READER_ROLES,
  PLATFORM_ADMIN_ROLES,
  rolesAllow,
} from "./adminRoles";

describe("adminRoles", () => {
  it("PLATFORM_ADMIN_ROLES is the same list as ADMIN_PLATFORM_ROLES", () => {
    expect([...PLATFORM_ADMIN_ROLES].sort()).toEqual([...ADMIN_PLATFORM_ROLES].sort());
  });

  it("platform roles mirror admin-service requireSuperAdmin exactly", () => {
    expect([...PLATFORM_ADMIN_ROLES].sort()).toEqual(["platform_admin", "super_admin"]);
  });

  it("api catalogue roles mirror gateway-service catalogue ADMIN_ROLES", () => {
    expect([...API_CATALOGUE_ROLES].sort()).toEqual(["api_admin", "platform_admin", "super_admin"]);
  });

  it("invoice readers mirror billing-service BILLING_ROLES", () => {
    expect([...BILLING_INVOICE_READER_ROLES].sort()).toEqual(["billing_admin", "platform_admin", "super_admin", "tenant_admin"]);
  });

  it("rolesAllow: tenant roles never pass the platform gate", () => {
    for (const r of ["employee", "manager", "tenant_admin", "hr_admin", "finance_officer"]) {
      expect(rolesAllow([r], PLATFORM_ADMIN_ROLES)).toBe(false);
    }
    expect(rolesAllow(["employee", "super_admin"], PLATFORM_ADMIN_ROLES)).toBe(true);
    expect(rolesAllow([], PLATFORM_ADMIN_ROLES)).toBe(false);
  });


});
