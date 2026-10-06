import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Drive the session-role JWT claim via cookies() and observe redirect(),
// mirroring crm/dedup-rules/layout.test.tsx.
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

import ComposeLayout from "./layout";

describe("ComposeLayout (GAP-NOTIFICATIONS-COMPOSE-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a role without send permission to the hub", () => {
    sessionWithRoles(["crm_user"]);
    render(<ComposeLayout>{"compose form"}</ComposeLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/notifications");
  });

  it("admits a notification send role", () => {
    sessionWithRoles(["notification_admin"]);
    render(<ComposeLayout>{"compose form"}</ComposeLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("compose form")).toBeInTheDocument();
  });

  it("admits the shared admin roles (super_admin, platform_admin, tenant_admin)", () => {
    for (const role of ["super_admin", "platform_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<ComposeLayout>{`form ${role}`}</ComposeLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects an unauthenticated session to the hub", () => {
    mockGet.mockReturnValue(undefined);
    render(<ComposeLayout>{"compose form"}</ComposeLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/notifications");
  });
});
