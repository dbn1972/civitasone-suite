import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// GAP-LIBRARY-HOME-02 / HOME-03: drive the session-role JWT claim via
// cookies() and observe redirect(), the same convention the crm/dedup-rules
// and billing layout tests use. These assertions fail on the old code, which
// had NO library/layout.tsx (only (app)/layout.tsx ran), so every tenant-role
// user could reach the engineering-finding catalogue.
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
  return `${header}.${body}.fakesig`; // gitleaks:allow
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import LibraryLayout from "./layout";

describe("LibraryLayout (GAP-LIBRARY-HOME-02 / HOME-03)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain tenant user (crm_user) away to /dashboard", () => {
    sessionWithRoles(["crm_user"]);
    render(<LibraryLayout>{"catalogue"}</LibraryLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an ordinary employee away from the dev-facing catalogue", () => {
    sessionWithRoles(["employee"]);
    render(<LibraryLayout>{"catalogue"}</LibraryLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits platform admins (platform_admin, super_admin, tenant_admin)", () => {
    for (const role of ["platform_admin", "super_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<LibraryLayout>{`body ${role}`}</LibraryLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(screen.getByText(`body ${role}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("redirects an unauthenticated session to /dashboard (fail closed)", () => {
    mockGet.mockReturnValue(undefined);
    render(<LibraryLayout>{"catalogue"}</LibraryLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
