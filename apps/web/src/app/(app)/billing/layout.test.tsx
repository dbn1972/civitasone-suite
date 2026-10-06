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
// ModuleGate is an async Server Component (can't render synchronously in jsdom);
// stub it to a passthrough so this test exercises only the role gate.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: unknown }) => children,
}));
// (moduleVisibility no longer reached, but keep a stub for safety.)
vi.mock("@/lib/moduleVisibility", () => ({
  getEnabledModules: async () => ["billing"],
  isModuleEnabled: () => true,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });
}

import BillingLayout from "./layout";

// GAP-BILLING-HOME-01: the billing segment had no role gate, so every tenant
// user saw IRN-cancel / GSTN-filing links. Fails on the old tree (no gate).
describe("BillingLayout role gate (GAP-BILLING-HOME-01)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it("redirects a plain tenant user (employee) away from the billing module", () => {
    sessionWithRoles(["employee"]);
    render(<BillingLayout>{"billing hub"}</BillingLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects an unauthenticated session", () => {
    mockGet.mockReturnValue(undefined);
    render(<BillingLayout>{"billing hub"}</BillingLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it.each(["billing_admin", "tenant_admin", "super_admin", "platform_admin", "finance_officer", "finance_admin"])(
    "admits %s (union of invoice + GSTN role sets)",
    (role) => {
      mockRedirect.mockReset();
      sessionWithRoles([role]);
      render(<BillingLayout>{`hub ${role}`}</BillingLayout>);
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );
});
