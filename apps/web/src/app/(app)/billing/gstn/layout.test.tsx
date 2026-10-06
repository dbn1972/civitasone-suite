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

import GstnLayout from "./layout";

// GAP-BILLING-GSTN-01: GSTN return filing is statutory + irreversible; the
// segment must be role-gated on the web as well as the server. These fail on
// the old tree (no gstn/layout.tsx existed).
describe("GstnLayout (GAP-BILLING-GSTN-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain tenant user (employee) away from the GSTN console", () => {
    sessionWithRoles(["employee"]);
    render(<GstnLayout>{"gstn console"}</GstnLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<GstnLayout>{"gstn console"}</GstnLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["finance_officer", "finance_admin", "billing_admin", "tenant_admin", "super_admin"])(
    "admits %s (mirrors billing-service gstn BILLING_ROLES)",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<GstnLayout>{`console ${role}`}</GstnLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(screen.getByText(`console ${role}`)).toBeInTheDocument();
      unmount();
    },
  );
});
