import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { requireAnyRole } = vi.hoisted(() => ({ requireAnyRole: vi.fn() }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole }));
vi.mock("../ModuleGate", () => ({ ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import TenantLayout from "./layout";
import TenantNotFound from "./not-found";
import Loading from "./loading";
import { TENANT_ADMIN_ROLES } from "./_roles";

// GAP-TENANT-{HOME-01, HOME-02, CONSENT-EXCHANGE-02}: the whole /tenant area is
// gated to the tenant-admin role set BEFORE the module gate, so a non-admin is
// redirected away and never sees an admin-only tile. The server remains the
// authority (services/tenant-service/tests/w2-tenant-web-paths-authz.test.ts).
describe("tenant layout role gate", () => {
  beforeEach(() => requireAnyRole.mockReset());

  it("asks for the tenant-admin role set (no employee/tenant_user role in it)", () => {
    render(<TenantLayout>content</TenantLayout>);
    expect(requireAnyRole).toHaveBeenCalledWith(TENANT_ADMIN_ROLES);
    expect(TENANT_ADMIN_ROLES).toEqual(["tenant_admin", "platform_admin", "super_admin"]);
  });

  it("a non-admin is bounced: the redirect thrown by requireAnyRole stops the children rendering", () => {
    const redirectSignal = { digest: "NEXT_REDIRECT" };
    requireAnyRole.mockImplementationOnce(() => {
      throw redirectSignal;
    });
    expect(() => TenantLayout({ children: "secret tiles" })).toThrow();
    expect(screen.queryByText("secret tiles")).not.toBeInTheDocument();
  });
});

// GAP-TENANT-HOME-03
describe("tenant not-found and loading states", () => {
  it("not-found shows a 'Back to Office home' link that points at /tenant", () => {
    render(<TenantNotFound />);
    expect(screen.getByRole("link", { name: "Back to Office home" })).toHaveAttribute("href", "/tenant");
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("loading renders the tile-grid skeleton (a polite status region)", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
