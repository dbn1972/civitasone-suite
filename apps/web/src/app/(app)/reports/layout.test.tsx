import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import ReportsLayout from "./layout";

describe("ReportsLayout (GAP2-REPORTS-ROLES-01)", () => {
  beforeEach(() => { mockGet.mockReset(); mockRedirect.mockReset(); });

  it("admits report_user AND report_viewer (both are canonical report readers)", () => {
    for (const role of ["report_user", "report_viewer"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<ReportsLayout>{`reports ${role}`}</ReportsLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects a user with no report role to the dashboard", () => {
    sessionWithRoles(["citizen"]);
    render(<ReportsLayout>{"reports"}</ReportsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits report_admin", () => {
    sessionWithRoles(["report_admin"]);
    render(<ReportsLayout>{"reports"}</ReportsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("reports")).toBeInTheDocument();
  });
});
