import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as hr/layout.test.tsx: control the session-role JWT
// claim via the cookies() mock, and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate is an async Server Component (tenant module-enablement check),
// irrelevant to this layout's own role gate; stub it to its children.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import IdentityLayout from "./layout";
import { IDENTITY_ADMIN_ROLES } from "@/lib/auth/identityRoles";

describe("IdentityLayout — GAP-IDENTITY-*-01 role gate", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain employee away from the identity admin surface (fails on the old ModuleGate-only layout)", () => {
    sessionWithRoles(["employee"]);
    render(<IdentityLayout>{"identity content"}</IdentityLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<IdentityLayout>{"identity content"}</IdentityLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits tenant_admin and renders children", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<IdentityLayout>{"identity content"}</IdentityLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("identity content")).toBeInTheDocument();
  });

  it.each(IDENTITY_ADMIN_ROLES)("admits a caller whose only role is %s", (role) => {
    sessionWithRoles([role]);
    render(<IdentityLayout>{"identity content"}</IdentityLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("IDENTITY_ADMIN_ROLES is exactly the tenant-admin set (no silent widening)", () => {
    expect(new Set(IDENTITY_ADMIN_ROLES)).toEqual(
      new Set(["tenant_admin", "platform_admin", "super_admin"]),
    );
  });

  it("rejects helpdesk / security roles not in the admin set (fail-closed default — flagged for review)", () => {
    for (const role of ["helpdesk", "security_officer", "manager", "citizen"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<IdentityLayout>{`identity ${role}`}</IdentityLayout>);
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
      unmount();
    }
  });
});
