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

import AdminLayout from "./layout";

describe("AdminLayout (SF-20)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a role the backend would refuse to /dashboard", () => {
    sessionWithRoles(["crm_user"]);
    render(<AdminLayout>{"inner"}</AdminLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects a session with no roles", () => {
    sessionWithRoles([]);
    render(<AdminLayout>{"inner"}</AdminLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["tenant_admin", "super_admin", "platform_admin", "api_admin", "billing_admin", "audit_officer", "hr_admin", "it_admin", "document_admin", "finance_admin", "payroll_admin"])("renders for %s inside ModuleGate 'admin'", (role) => {
    sessionWithRoles([role]);
    render(<AdminLayout>{"inner"}</AdminLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("module-gate").getAttribute("data-module")).toBe("admin");
    expect(screen.getByText("inner")).toBeInTheDocument();
  });
});
