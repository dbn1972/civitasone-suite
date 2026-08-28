import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as lib/auth/roleGuard.test.ts: control the
// session-role JWT claim via the cookies() mock, and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate itself is an async Server Component (checks tenant module
// enablement) -- irrelevant to this layout's own role gate, and a real
// async component can't be exercised through a synchronous RTL render, so
// stub it down to its children.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import HrLayout from "./layout";

describe("HrLayout", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("admits a plain employee instead of redirecting them away (ESS root-cause fix)", () => {
    // Regression test: HR_ROLES used to omit "employee" entirely, so every
    // self-service code path inside /hr (hr/leave/apply's getMyProfile()
    // fallback, hr/dashboard's own-profile card, hr/payroll's
    // canAdminister-gated view) was unreachable dead code -- a plain
    // employee was redirected to /dashboard before any of it ever ran.
    sessionWithRoles(["employee"]);

    render(<HrLayout>{"hr content"}</HrLayout>);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("hr content")).toBeInTheDocument();
  });

  it("admits a manager", () => {
    sessionWithRoles(["manager"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("still admits hr_admin (unaffected by the widened list)", () => {
    sessionWithRoles(["hr_admin"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("still redirects a role with no HR/ESS relationship at all", () => {
    sessionWithRoles(["citizen"]);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("still redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<HrLayout>{"hr content"}</HrLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
