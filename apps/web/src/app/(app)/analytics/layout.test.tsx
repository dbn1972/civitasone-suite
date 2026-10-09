import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Control the session-role JWT via cookies() and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
// ModuleGate is a server component that may hit the module registry; stub it
// to just render children so this test isolates the ROLE gate.
vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import AnalyticsLayout from "./layout";

describe("AnalyticsLayout (GAP2-ANALYTICS-ROLES-01)", () => {
  beforeEach(() => { mockGet.mockReset(); mockRedirect.mockReset(); });

  it("admits an analytics_user (regression: layout had no role gate, only ModuleGate)", () => {
    sessionWithRoles(["analytics_user"]);
    render(<AnalyticsLayout>{"analytics"}</AnalyticsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("analytics")).toBeInTheDocument();
  });

  it("admits an analytics_viewer", () => {
    sessionWithRoles(["analytics_viewer"]);
    render(<AnalyticsLayout>{"analytics"}</AnalyticsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects a user with no analytics role to the dashboard", () => {
    sessionWithRoles(["citizen"]);
    render(<AnalyticsLayout>{"analytics"}</AnalyticsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<AnalyticsLayout>{"analytics"}</AnalyticsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
