import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Control the session-role JWT claim via cookies() and observe redirect(),
// mirroring agent-workload/layout.test.tsx and lib/auth/roleGuard.test.ts.
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

// ModuleGate reaches for server data; stub it to just render its children so
// this test isolates the role gate in the layout itself.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import CrmLayout from "./layout";

describe("CrmLayout module gate (GAP2-CRM-LAYOUT-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("admits the CRM read roles the crm-service accepts", () => {
    // crm-service read routes accept crm_user/crm_admin/super_admin and (on 40+
    // routes) tenant_admin, so all four reach the module.
    for (const role of ["crm_user", "crm_admin", "super_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<CrmLayout>{`crm ${role}`}</CrmLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("no longer admits a platform_admin-only session", () => {
    // GAP2-CRM-LAYOUT-01: platform_admin is accepted by NO crm-service route, so
    // admitting it to the module produced a user who passed the gate yet got 403
    // on every CRM read and write. The gate now denies it so UI and server agree.
    sessionWithRoles(["platform_admin"]);
    render(<CrmLayout>{"crm platform_admin"}</CrmLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects a session with no CRM role", () => {
    sessionWithRoles(["finance_user"]);
    render(<CrmLayout>{"crm nobody"}</CrmLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
