import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// SF-20: drive the session roles through the access-token cookie and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
// ModuleGate is an async server component; stub it to expose the key it was given.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) => (
    <div data-testid="module-gate" data-module={moduleKey}>{children}</div>
  ),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import ApprovalsLayout from "./layout";

describe("ApprovalsLayout (SF-20)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a role the backend would refuse to /dashboard", () => {
    sessionWithRoles(["viewer"]);
    render(<ApprovalsLayout>{"inner"}</ApprovalsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects a session with no roles", () => {
    sessionWithRoles([]);
    render(<ApprovalsLayout>{"inner"}</ApprovalsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["workflow_user", "workflow_admin", "manager", "hr_admin", "procurement_officer", "estab_deputy_secretary", "super_admin"])("renders for %s inside ModuleGate 'workflow'", (role) => {
    sessionWithRoles([role]);
    render(<ApprovalsLayout>{"inner"}</ApprovalsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("module-gate").getAttribute("data-module")).toBe("workflow");
    expect(screen.getByText("inner")).toBeInTheDocument();
  });
});

describe("ApprovalsLayout role list (SF-20)", () => {
  it("mirrors workflow-service: tenant_admin is not a task-inbox role", async () => {
    const { WORKFLOW_TASK_ROLES } = await import("@/lib/auth/workRoles");
    expect(WORKFLOW_TASK_ROLES).not.toContain("tenant_admin");
    expect(WORKFLOW_TASK_ROLES).toContain("workflow_user");
  });
});
