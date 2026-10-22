import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
const sessionWithRoles = (roles: string[]) => mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });

import InspectionLayout from "./layout";

describe("InspectionLayout role gate", () => {
  beforeEach(() => { mockGet.mockReset(); mockRedirect.mockReset(); });

  it.each(["inspector", "reviewing_officer", "supervising_officer", "inspection_admin", "tenant_admin", "super_admin"])(
    "admits %s", (role) => {
      sessionWithRoles([role]);
      render(<InspectionLayout>{"inspection-body"}</InspectionLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(screen.getByText("inspection-body")).toBeInTheDocument();
    },
  );

  it("redirects a role with no inspection permission to the dashboard", () => {
    sessionWithRoles(["citizen"]);
    render(<InspectionLayout>{"inspection-body"}</InspectionLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<InspectionLayout>{"inspection-body"}</InspectionLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
