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

import ContactsImportLayout from "./layout";

describe("ContactsImportLayout (bulk import is crm_admin / super_admin only)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it.each(["crm_user", "tenant_admin"])("redirects %s to /crm/contacts instead of a form the server 403s", (role) => {
    sessionWithRoles([role]);
    render(<ContactsImportLayout>{"import form"}</ContactsImportLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm/contacts");
  });

  it.each(["crm_admin", "super_admin"])("admits %s", (role) => {
    sessionWithRoles([role]);
    render(<ContactsImportLayout>{"import form"}</ContactsImportLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("import form")).toBeInTheDocument();
  });
});
