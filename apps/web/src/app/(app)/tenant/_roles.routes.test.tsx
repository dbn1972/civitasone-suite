import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAnyRole, getRequestPathname } = vi.hoisted(() => ({ requireAnyRole: vi.fn(), getRequestPathname: vi.fn() }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole }));
vi.mock("@/lib/auth/requestPath", () => ({ getRequestPathname }));
vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: unknown }) => children }));

import TenantLayout from "./layout";
import TenantAdminLayout from "../tenant-admin/layout";
import { adminAreaRoles, TENANT_ADMIN_ROLES } from "./_roles";

// Owner-decision officer roles must reach the screen that carries their action
// (consent_officer #19, audit_officer #20, security_admin #21, migration_admin #23),
// and ONLY that screen: every other page in the area stays tenant-admin only.
const OFFICER_ROUTES: Array<[string, string, "tenant" | "tenant-admin"]> = [
  ["/tenant/consent-exchange", "consent_officer", "tenant"],
  ["/tenant/data-migration", "migration_admin", "tenant"],
  ["/tenant-admin/audit", "audit_officer", "tenant-admin"],
  ["/tenant-admin/sessions", "security_admin", "tenant-admin"],
];

describe("adminAreaRoles: officer roles are route-scoped", () => {
  it("falls back to the strict tenant-admin set with no path", () => {
    expect(adminAreaRoles(null)).toEqual(TENANT_ADMIN_ROLES);
  });

  it.each(OFFICER_ROUTES)("%s admits %s and its sub-paths", (route, role) => {
    expect(adminAreaRoles(route)).toEqual([...TENANT_ADMIN_ROLES, role]);
    expect(adminAreaRoles(`${route}/abc`)).toContain(role);
  });

  it.each(OFFICER_ROUTES)("%s role is NOT admitted to sibling or look-alike routes", (route, role) => {
    expect(adminAreaRoles(`${route}-x`)).not.toContain(role);
    expect(adminAreaRoles("/tenant/settings")).not.toContain(role);
    expect(adminAreaRoles("/tenant-admin/users")).not.toContain(role);
    expect(adminAreaRoles("/tenant")).not.toContain(role);
  });
});

describe("layouts pass the route-scoped role set to requireAnyRole", () => {
  beforeEach(() => { requireAnyRole.mockClear(); getRequestPathname.mockReset(); });

  it.each(OFFICER_ROUTES)("%s: the officer role reaches the %s layout", (route, role, area) => {
    getRequestPathname.mockReturnValue(route);
    (area === "tenant" ? TenantLayout : TenantAdminLayout)({ children: null });
    expect(requireAnyRole.mock.calls[0][0]).toContain(role);
  });

  it("an unrelated page in either area is still tenant-admin only", () => {
    getRequestPathname.mockReturnValue("/tenant/usage");
    TenantLayout({ children: null });
    getRequestPathname.mockReturnValue("/tenant-admin/users");
    TenantAdminLayout({ children: null });
    expect(requireAnyRole).toHaveBeenNthCalledWith(1, TENANT_ADMIN_ROLES);
    expect(requireAnyRole).toHaveBeenNthCalledWith(2, TENANT_ADMIN_ROLES);
  });
});
