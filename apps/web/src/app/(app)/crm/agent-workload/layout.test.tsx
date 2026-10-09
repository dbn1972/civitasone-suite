import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same convention as hr/layout.test.tsx and lib/auth/roleGuard.test.ts:
// control the session-role JWT claim via cookies() and observe redirect().
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

import AgentWorkloadLayout from "./layout";

describe("AgentWorkloadLayout (GAP-CRM-AGENT-WORKLOAD-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain crm_user away from the capacity editor", () => {
    // Regression: this route had no layout and fell through to the broad CRM
    // layout, so any crm_user got a fully-wired platform-wide capacity editor.
    sessionWithRoles(["crm_user"]);
    render(<AgentWorkloadLayout>{"workload editor"}</AgentWorkloadLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });

  it("admits crm_admin", () => {
    sessionWithRoles(["crm_admin"]);
    render(<AgentWorkloadLayout>{"workload editor"}</AgentWorkloadLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("workload editor")).toBeInTheDocument();
  });

  it("admits the teams-route admin roles (super_admin, tenant_admin)", () => {
    // GAP2-CRM-AGENT-WORKLOAD-05: the gate now matches the crm-service teams
    // routes exactly, which accept [crm_admin, super_admin, tenant_admin] for the
    // capacity write. super_admin and tenant_admin are admitted.
    for (const role of ["super_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<AgentWorkloadLayout>{`editor ${role}`}</AgentWorkloadLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects admin and platform_admin (no teams route accepts them)", () => {
    // GAP2-CRM-AGENT-WORKLOAD-05: these roles passed the broad CRM_ADMIN_ROLES
    // set but NO crm-service teams route accepts them, so they used to get a
    // fully-wired capacity editor that could neither load (GET agents 403) nor
    // save (PATCH capacity 403). The gate now denies them so UI and server agree.
    for (const role of ["admin", "platform_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<AgentWorkloadLayout>{`editor ${role}`}</AgentWorkloadLayout>);
      expect(mockRedirect).toHaveBeenCalledWith("/crm");
      unmount();
    }
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<AgentWorkloadLayout>{"workload editor"}</AgentWorkloadLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });
});
