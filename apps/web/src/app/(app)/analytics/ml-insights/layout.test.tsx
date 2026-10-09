import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import MLInsightsLayout from "./layout";

describe("MLInsightsLayout (GAP2-ANALYTICS-MLINSIGHTS-01)", () => {
  beforeEach(() => { mockGet.mockReset(); mockRedirect.mockReset(); });

  it("redirects a plain analytics_user BEFORE any fetch (backing endpoint only admits ML_INSIGHTS_READ_ROLES)", () => {
    sessionWithRoles(["analytics_user"]);
    render(<MLInsightsLayout>{"ml insights"}</MLInsightsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects a plain analytics_viewer", () => {
    sessionWithRoles(["analytics_viewer"]);
    render(<MLInsightsLayout>{"ml insights"}</MLInsightsLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("admits ml_admin / analytics_admin / super_admin", () => {
    for (const role of ["ml_admin", "analytics_admin", "super_admin"]) {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      const { unmount } = render(<MLInsightsLayout>{`ml ${role}`}</MLInsightsLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      unmount();
    }
  });
});
