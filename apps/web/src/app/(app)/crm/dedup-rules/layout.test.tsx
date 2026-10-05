import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same convention as agent-workload/layout.test.tsx: drive the session-role
// JWT claim via cookies() and observe redirect().
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

import DedupRulesLayout from "./layout";

describe("DedupRulesLayout (GAP-CRM-DEDUP-RULES-05)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain crm_user to /crm/data-quality", () => {
    sessionWithRoles(["crm_user"]);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm/data-quality");
  });

  it("admits crm_admin", () => {
    sessionWithRoles(["crm_admin"]);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("rules editor")).toBeInTheDocument();
  });

  it("admits the shared CRM admin roles (super_admin, platform_admin, admin, tenant_admin)", () => {
    for (const role of ["super_admin", "platform_admin", "admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<DedupRulesLayout>{`editor ${role}`}</DedupRulesLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects an unauthenticated session to /crm/data-quality", () => {
    mockGet.mockReturnValue(undefined);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm/data-quality");
  });
});
