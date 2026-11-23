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

import DashboardLayout from "./layout";
import NewCaseLayout from "../cases/new/layout";

describe.each([
  ["dashboard", DashboardLayout],
  ["cases/new", NewCaseLayout],
])("Legal %s layout (legal-service: legal_officer / legal_admin / super_admin only)", (_name, Layout) => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });
  const as = (roles: string[]) => mockGet.mockReturnValue({ value: makeJwt({ sub: "u", roles }) });

  it("redirects audit_officer to the Legal hub instead of a 403 page", () => {
    as(["audit_officer"]);
    render(<Layout>{"body"}</Layout>);
    expect(mockRedirect).toHaveBeenCalledWith("/legal");
  });

  it.each(["legal_officer", "legal_admin", "super_admin"])("admits %s", (role) => {
    as([role]);
    render(<Layout>{"body"}</Layout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
