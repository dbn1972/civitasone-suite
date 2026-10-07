import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

function makeJwt(payload: Record<string, unknown>): string {
  // Opaque test cookie: roleGuard only reads the middle segment, so the other
  // two are placeholders and the string is not JWT-shaped.
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `h.${body}.s`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import DeveloperPortalLayout from "./layout";

// GAP-DEVELOPER-PORTAL-HOME-04 (ROLEGATE): the segment had no layout, so any
// authenticated user could read API-key metadata. Fails on the old tree (no
// layout.tsx existed at all).
describe("DeveloperPortalLayout role gate (GAP-DEVELOPER-PORTAL-HOME-04)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain tenant user (employee) away from the developer portal", () => {
    sessionWithRoles(["employee"]);
    render(<DeveloperPortalLayout>{"portal"}</DeveloperPortalLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<DeveloperPortalLayout>{"portal"}</DeveloperPortalLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["tenant_admin", "platform_admin", "super_admin"])(
    "admits %s (mirrors the API-key management surface)",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      render(<DeveloperPortalLayout>{`portal ${role}`}</DeveloperPortalLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );
});
