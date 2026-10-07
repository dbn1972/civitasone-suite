import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import DomainsLayout from "./layout";

// GAP-DOMAINS-NEW-05: /domains had no layout, so any authenticated user could
// register a government domain and submit personal contact data. The segment
// is now gated to platform/tenant admins. These fail on the old tree.
describe("DomainsLayout (GAP-DOMAINS-NEW-05)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain employee away from /domains", () => {
    sessionWithRoles(["employee"]);
    render(<DomainsLayout>{"domains"}</DomainsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<DomainsLayout>{"domains"}</DomainsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["platform_admin", "tenant_admin", "super_admin", "admin"])(
    "admits %s",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<DomainsLayout>{`ok ${role}`}</DomainsLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(screen.getByText(`ok ${role}`)).toBeInTheDocument();
      unmount();
    },
  );
});
