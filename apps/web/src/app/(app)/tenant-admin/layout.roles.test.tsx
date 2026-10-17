import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAnyRole = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole: (r: string[]) => requireAnyRole(r) }));

import TenantAdminLayout from "./layout";
import TenantLayout from "../tenant/layout";
import { TENANT_ADMIN_ROLES } from "../tenant/_roles";

vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: unknown }) => children }));

// GAP-TENANT-ORG-HIERARCHY-01: /tenant/org-hierarchy (gated by tenant/layout.tsx)
// redirects into /tenant-admin (gated by tenant-admin/layout.tsx). The two role
// sets must be identical so the redirect never lands a permitted role on a
// page that bounces it.
describe("tenant and tenant-admin layouts gate on the same role set", () => {
  beforeEach(() => requireAnyRole.mockClear());

  it("passes identical roles to requireAnyRole", () => {
    TenantAdminLayout({ children: null });
    TenantLayout({ children: null });
    expect(requireAnyRole).toHaveBeenCalledTimes(2);
    const [adminRoles] = requireAnyRole.mock.calls[0] as [string[]];
    const [tenantRoles] = requireAnyRole.mock.calls[1] as [string[]];
    expect([...adminRoles].sort()).toEqual([...tenantRoles].sort());
    expect([...adminRoles].sort()).toEqual([...TENANT_ADMIN_ROLES].sort());
  });
});
