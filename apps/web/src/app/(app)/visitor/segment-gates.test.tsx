import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GAP-VISITOR-ADMIN-02 / GAP-VISITOR-HOME-02: the /visitor/admin and
 * /visitor/guard segments must be role-gated (defence-in-depth over the
 * visitor-service enforcement). These tests assert the layout calls
 * requireAnyRole with the right role sets and redirects a user who lacks them.
 */
let mockRoles: string[] = [];
const redirectCalls: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { redirectCalls.push(to); throw new Error("REDIRECT:" + to); },
}));
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  const { redirect } = await import("next/navigation");
  return {
    ...actual,
    getSessionRoles: () => mockRoles,
    requireAnyRole: (allowed: string[], to = "/dashboard") => {
      if (!allowed.some((r) => mockRoles.includes(r))) redirect(to);
    },
  };
});

import VisitorAdminLayout from "./admin/layout";
import VisitorGuardLayout from "./guard/layout";

describe("visitor segment role gates", () => {
  beforeEach(() => { mockRoles = []; redirectCalls.length = 0; });

  it("admin layout redirects a non-admin to /visitor", () => {
    mockRoles = ["employee"];
    expect(() => VisitorAdminLayout({ children: null })).toThrow(/REDIRECT:\/visitor/);
  });

  it("admin layout admits a tenant_admin", () => {
    mockRoles = ["tenant_admin"];
    expect(() => VisitorAdminLayout({ children: null })).not.toThrow();
  });

  it("guard layout redirects a user with no guard-capable role to /visitor", () => {
    mockRoles = ["some_unrelated_role"];
    expect(() => VisitorGuardLayout({ children: null })).toThrow(/REDIRECT:\/visitor/);
  });

  it("guard layout admits security_admin", () => {
    mockRoles = ["security_admin"];
    expect(() => VisitorGuardLayout({ children: null })).not.toThrow();
  });
});
