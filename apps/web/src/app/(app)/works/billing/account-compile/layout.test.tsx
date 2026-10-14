import { describe, it, expect, vi } from "vitest";

// Role-aware stand-in for requireAnyRole: throws (as next/navigation's redirect does) when the session lacks the roles.
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: (allowed: string[], to: string) => {
    if (!allowed.some((r) => mockRoles.includes(r))) throw new Error(`REDIRECT:${to}`);
  },
}));

import AccountCompileLayout from "./layout";

describe("GAP-WORKS-BILLING-ACCOUNT-COMPILE-02: account compile is DAO/DO-only", () => {
  it("a user without the role is redirected to the billing register before any form renders", () => {
    mockRoles = ["section_officer"];
    expect(() => AccountCompileLayout({ children: "form" })).toThrow("REDIRECT:/works/billing");
  });

  it("a DAO, a DO and the admin overrides see the form", () => {
    for (const role of ["dao", "do", "works_admin", "super_admin"]) {
      mockRoles = [role];
      expect(() => AccountCompileLayout({ children: "form" }), role).not.toThrow();
    }
  });
});
