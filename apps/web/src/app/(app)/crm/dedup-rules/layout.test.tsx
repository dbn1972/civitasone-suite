import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same convention as agent-workload/layout.test.tsx: drive the session-role
// JWT claim via cookies() and observe redirect().
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

import DedupRulesLayout from "./layout";

describe("DedupRulesLayout (GAP-CRM-DEDUP-RULES-05)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain crm_user to /crm/data-quality", () => {
    sessionWithRoles(["crm_user"]);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm/data-quality");
  });

  it("admits crm_admin", () => {
    sessionWithRoles(["crm_admin"]);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("rules editor")).toBeInTheDocument();
  });

  it("admits super_admin as well as crm_admin (the roles the server admits on dedup-rules)", () => {
    sessionWithRoles(["super_admin"]);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("rules editor")).toBeInTheDocument();
  });

  // GAP-CRM-DEDUP-RULES-05: these were admitted via the broader CRM_ADMIN_ROLES
  // but cannot use the page -- admin / platform_admin never clear the parent CRM
  // layout and tenant_admin is 403'd by crm-service. Narrowing the web gate to
  // the server's set changes nobody's real access.
  it.each(["tenant_admin", "admin", "platform_admin"])(
    "redirects %s to /crm/data-quality instead of showing a page whose calls cannot succeed",
    (role) => {
      sessionWithRoles([role]);
      render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
      expect(mockRedirect).toHaveBeenCalledWith("/crm/data-quality");
    },
  );

  it("redirects an unauthenticated session to /crm/data-quality", () => {
    mockGet.mockReturnValue(undefined);
    render(<DedupRulesLayout>{"rules editor"}</DedupRulesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm/data-quality");
  });
});
