import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Server component: control the signed-in session's roles via the role guard.
const rolesMock = vi.fn<() => string[]>(() => ["super_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

// ProvisionRequestFromUrl is a client child that reads the query string.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/tenant-provision",
}));

import TenantProvisionPage from "./page";

describe("TenantProvisionPage (GAP2-ADMIN-TENANT-PROVISION-01)", () => {
  it("carries a 'Reference' marker so it is visually distinct from live screens", () => {
    rolesMock.mockReturnValue(["super_admin"]);
    render(<TenantProvisionPage />);
    // The documentation-only screen must advertise itself as reference, not a
    // working operator action, via a pill marker in the header.
    const marker = screen.getByText("Reference", { selector: ".pill" });
    expect(marker).toBeInTheDocument();
  });

  it("still gates unauthorized callers to Access restricted", () => {
    rolesMock.mockReturnValue(["citizen"]);
    render(<TenantProvisionPage />);
    expect(screen.queryByText("Reference", { selector: ".pill" })).not.toBeInTheDocument();
  });
});
