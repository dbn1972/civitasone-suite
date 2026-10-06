import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/roleGuard", () => ({ requireAnyRole: vi.fn() }));

const getCurrentTenantOrgTypeMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getCurrentTenantOrgType: (...a: unknown[]) => getCurrentTenantOrgTypeMock(...a),
}));

import OrgTypePage from "./page";

describe("OrgTypePage — GAP-TENANT-ADMIN-ORG-TYPE-01/02", () => {
  beforeEach(() => getCurrentTenantOrgTypeMock.mockReset());

  it("renders the selector and NO developer PATCH snippet / 'coming soon'", async () => {
    getCurrentTenantOrgTypeMock.mockResolvedValue({ data: { tenantId: "t1", orgType: "govt_dept", settings: { orgType: "govt_dept" } }, source: "api" });
    render(await OrgTypePage());
    expect(screen.getByRole("radiogroup", { name: /organisation type/i })).toBeInTheDocument();
    // GAP-ORG-TYPE-02: no dev copy
    expect(screen.queryByText(/PATCH \/v1\/tenants/)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    // current type marked
    expect(screen.getAllByText("Current").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error state when the tenant could not be loaded", async () => {
    getCurrentTenantOrgTypeMock.mockResolvedValue({ data: { tenantId: null, orgType: null, settings: {} }, source: "error" });
    render(await OrgTypePage());
    expect(screen.getByText(/couldn't load organisation type/i)).toBeInTheDocument();
  });
});
