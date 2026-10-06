import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Same convention as hr/layout.test.tsx: drive the session-role JWT via the
// cookies() mock and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
// ModuleGate is an async Server Component (tenant module enablement); not this
// layout's own role gate, so stub to its children.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: ReactNode }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import Layout from "./layout";
import { CATALOGUE_READER_ROLES } from "@/lib/auth/roleGuard";

describe("Catalogue layout gate — GAP-CATALOGUE-HOME-02", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it.each(CATALOGUE_READER_ROLES)("admits a caller whose only role is %s", (role) => {
    sessionWithRoles([role]);
    render(<Layout>{"catalogue content"}</Layout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("catalogue content")).toBeInTheDocument();
  });

  it("redirects a role with no catalogue relationship to /dashboard", () => {
    sessionWithRoles(["citizen"]);
    render(<Layout>{"catalogue content"}</Layout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<Layout>{"catalogue content"}</Layout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("mirrors catalogue-service's reader roles exactly (no silent drift)", () => {
    expect(new Set(CATALOGUE_READER_ROLES)).toEqual(
      new Set(["catalogue_user", "catalogue_admin", "super_admin"]),
    );
  });
});
