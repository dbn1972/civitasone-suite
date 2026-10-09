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
// ModuleGate is an async Server Component; stub it to a passthrough so this
// test exercises only the role gate.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: unknown }) => children,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import LocationsLayout from "./layout";

// GAP2-LOCATIONS-HOME-02: the /locations segment had no layout and no web role
// gate — any signed-in user could open the hub + child pages and only hit
// failed fetches. Fails on the old tree (no layout.tsx existed).
describe("LocationsLayout role gate (GAP2-LOCATIONS-HOME-02)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a user with no location role (finance_admin) away from the module", () => {
    sessionWithRoles(["finance_admin"]);
    render(<LocationsLayout>{"locations hub"}</LocationsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<LocationsLayout>{"locations hub"}</LocationsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["location_user", "location_admin", "super_admin", "employee"])(
    "admits %s (mirrors location-service LOCATION_VIEW_ROLES)",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      render(<LocationsLayout>{"locations hub"}</LocationsLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );
});
