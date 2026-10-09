import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate is an async Server Component (tenant module enablement); not this
// gate's concern — stub it to render its children.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: ReactNode }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import ProjectsLayout from "./layout";

// GAP2-PROJECTS-LAYOUT-AUTHZ-01: the projects tree previously had NO role gate
// (only ModuleGate). These fail on the old layout (which never called
// requireAnyRole), mirroring grants/layout.tsx.
describe("ProjectsLayout (GAP2-PROJECTS-LAYOUT-AUTHZ-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a signed-in user with no projects role to /dashboard", () => {
    sessionWithRoles(["employee"]);
    render(<ProjectsLayout>{"projects tree"}</ProjectsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<ProjectsLayout>{"projects tree"}</ProjectsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each([
    "project_officer",
    "project_manager",
    "project_admin",
    "finance_officer",
    "tenant_admin",
    "super_admin",
    "audit_officer",
  ])("admits %s (mirrors project-service READER roles)", (role) => {
    mockRedirect.mockReset();
    sessionWithRoles([role]);
    const { unmount } = render(<ProjectsLayout>{`tree ${role}`}</ProjectsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText(`tree ${role}`)).toBeInTheDocument();
    unmount();
  });
});
