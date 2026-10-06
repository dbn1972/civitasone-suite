import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same convention as crm/agent-workload/layout.test.tsx: control the
// session-role JWT claim via cookies() and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import PlatformAdminLayout from "./layout";

describe("PlatformAdminLayout (GAP-PLATFORM-ADMIN-ROLES-02 / SYSTEM-SETTINGS-03)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain hr_staff user away from the platform-admin segment", () => {
    // Regression: segment had no layout/requireAnyRole, so any signed-in user
    // reached the role matrix, security settings and full audit log.
    sessionWithRoles(["hr_staff"]);
    render(<PlatformAdminLayout>{"platform admin"}</PlatformAdminLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits platform_admin", () => {
    sessionWithRoles(["platform_admin"]);
    render(<PlatformAdminLayout>{"platform admin"}</PlatformAdminLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("platform admin")).toBeInTheDocument();
  });

  it("admits super_admin and tenant_admin", () => {
    for (const role of ["super_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<PlatformAdminLayout>{`admin ${role}`}</PlatformAdminLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<PlatformAdminLayout>{"platform admin"}</PlatformAdminLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits audit reviewers into the segment (their audit-log access is preserved; other pages re-check)", () => {
    for (const role of ["auditor", "audit_admin", "audit_officer"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<PlatformAdminLayout>{`audit ${role}`}</PlatformAdminLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });
});
