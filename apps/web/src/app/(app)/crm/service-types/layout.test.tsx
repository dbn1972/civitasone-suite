import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

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

import ServiceTypesLayout from "./layout";

/**
 * GAP2-CRM-SERVICE-TYPES-03: the layout role list must match the backing
 * service-requests routes, whose ADMIN_ROLES = [crm_admin, super_admin,
 * tenant_admin] guard the service-type master writes.
 */
describe("ServiceTypesLayout role parity (GAP2-CRM-SERVICE-TYPES-03)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("admits exactly the roles the service-request routes accept", () => {
    for (const role of ["crm_admin", "super_admin", "tenant_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<ServiceTypesLayout>{`st ${role}`}</ServiceTypesLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("redirects admin and platform_admin (no service-request route accepts them)", () => {
    for (const role of ["admin", "platform_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<ServiceTypesLayout>{`st ${role}`}</ServiceTypesLayout>);
      expect(mockRedirect).toHaveBeenCalledWith("/crm");
      unmount();
    }
  });

  it("redirects a plain crm_user", () => {
    sessionWithRoles(["crm_user"]);
    render(<ServiceTypesLayout>{"st crm_user"}</ServiceTypesLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/crm");
  });
});
