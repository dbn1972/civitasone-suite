import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same convention as agent-workload/layout.test.tsx: control the session-role
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

import PipelinesLayout from "./layout";

describe("PipelinesLayout (GAP-CRM-PIPELINES-03)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain crm_user away from the pipeline editor", () => {
    // Regression: this route had no layout and fell through to the broad CRM
    // layout, so any crm_user got a fully-wired create/edit/delete editor.
    sessionWithRoles(["crm_user"]);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });

  it("admits crm_admin", () => {
    sessionWithRoles(["crm_admin"]);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("pipeline editor")).toBeInTheDocument();
  });

  it("admits the other admin roles the sibling layouts allow", () => {
    for (const role of ["admin", "super_admin", "platform_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<PipelinesLayout>{`editor ${role}`}</PipelinesLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<PipelinesLayout>{"pipeline editor"}</PipelinesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });
});
