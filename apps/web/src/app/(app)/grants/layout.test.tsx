import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: ReactNode }) => children }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import GrantsLayout from "./layout";
import NewSchemeLayout from "./schemes/new/layout";
import ApplyLayout from "./schemes/[id]/apply/layout";

// A user without a grants role must see the "Access restricted" screen, not be
// silently bounced to /dashboard (which looked like a broken link).
describe("grants layouts render PermissionDenied instead of redirecting", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("module layout: no grants role -> PermissionDenied, no redirect, children hidden", () => {
    sessionWithRoles(["employee"]);
    render(<GrantsLayout>{"grants tree"}</GrantsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.queryByText("grants tree")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /return to command center/i })).toHaveAttribute("href", "/dashboard");
  });

  it("module layout: unauthenticated -> PermissionDenied", () => {
    mockGet.mockReturnValue(undefined);
    render(<GrantsLayout>{"grants tree"}</GrantsLayout>);
    expect(screen.queryByText("grants tree")).not.toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("module layout: a viewer reaches the tree", () => {
    sessionWithRoles(["grant_viewer"]);
    render(<GrantsLayout>{"grants tree"}</GrantsLayout>);
    expect(screen.getByText("grants tree")).toBeInTheDocument();
  });

  it("new-scheme layout: a viewer (not a maker) sees PermissionDenied linking back to schemes", () => {
    sessionWithRoles(["grant_viewer"]);
    render(<NewSchemeLayout>{"new scheme form"}</NewSchemeLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.queryByText("new scheme form")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to schemes/i })).toHaveAttribute("href", "/grants/schemes");
  });

  it("new-scheme layout: a maker reaches the form", () => {
    sessionWithRoles(["grant_officer"]);
    render(<NewSchemeLayout>{"new scheme form"}</NewSchemeLayout>);
    expect(screen.getByText("new scheme form")).toBeInTheDocument();
  });

  it("apply layout: a viewer sees PermissionDenied; a maker reaches the form", () => {
    sessionWithRoles(["grant_viewer"]);
    const { unmount } = render(<ApplyLayout>{"apply form"}</ApplyLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.queryByText("apply form")).not.toBeInTheDocument();
    unmount();
    sessionWithRoles(["grant_admin"]);
    render(<ApplyLayout>{"apply form"}</ApplyLayout>);
    expect(screen.getByText("apply form")).toBeInTheDocument();
  });
});
