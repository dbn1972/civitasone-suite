import { describe, it, expect, vi } from "vitest";

// Role-aware stand-in for requireAnyRole: throws (like next/navigation redirect) when the session lacks the roles.
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: (allowed: string[], to: string) => {
    if (!allowed.some((r) => mockRoles.includes(r))) throw new Error(`REDIRECT:${to}`);
  },
}));

import NewAaLayout from "./new/layout";
import NewTsLayout from "./ts-new/layout";

describe("GAP-WORKS-APPROVALS-05: direct-URL role guard on the create pages", () => {
  it("Given a user without AA create roles, When they open /works/approvals/new, Then they are redirected to the register", () => {
    mockRoles = ["employee"];
    expect(() => NewAaLayout({ children: null })).toThrow("REDIRECT:/works/approvals");
  });

  it("Given a user without TS create roles, When they open /works/approvals/ts-new, Then they are redirected to the register", () => {
    mockRoles = ["works_viewer"];
    expect(() => NewTsLayout({ children: null })).toThrow("REDIRECT:/works/approvals");
  });

  it("Given an authorised user, When they open either page, Then the form renders", () => {
    mockRoles = ["dao"];
    expect(() => NewAaLayout({ children: "form" })).not.toThrow();
    expect(() => NewTsLayout({ children: "form" })).not.toThrow();
  });
});
