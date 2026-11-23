import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mockRedirect(...args) }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import ContactsLayout from "./layout";

describe("ContactsLayout (crm-service contacts reads: crm_user / crm_admin / super_admin)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects tenant_admin to the CRM hub instead of a list the server 403s", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<ContactsLayout>{"contacts"}</ContactsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });

  it.each(["crm_user", "crm_admin", "super_admin"])("admits %s", (role) => {
    sessionWithRoles([role]);
    render(<ContactsLayout>{"contacts"}</ContactsLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("contacts")).toBeInTheDocument();
  });
});
