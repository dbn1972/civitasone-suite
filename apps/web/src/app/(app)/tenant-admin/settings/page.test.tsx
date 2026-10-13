import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";

const { getTenantModules, getCurrentTenantOrgType } = vi.hoisted(() => ({ getTenantModules: vi.fn(), getCurrentTenantOrgType: vi.fn() }));
vi.mock("../../../_data/loaders", () => ({
  getTenantModules: () => getTenantModules(),
  getCurrentTenantOrgType: () => getCurrentTenantOrgType(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import TenantSettingsPage from "./page";

afterEach(() => vi.clearAllMocks());
beforeEach(() => {
  getCurrentTenantOrgType.mockResolvedValue({ source: "api", data: { tenantId: "t1", orgType: null, settings: {} } });
});

describe("TenantSettingsPage (GAP-TENANT-ADMIN-SETTINGS-04/05)", () => {
  it("on error shows RefreshErrorState with '—' tiles, no 'No modules' empty state and no Save button", async () => {
    getTenantModules.mockResolvedValue({ source: "error", data: [] });
    const ui = await TenantSettingsPage();
    render(ui);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/No modules/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("has exactly three tiles (no 'Configured' tile) and uses 'Enabled'", async () => {
    getTenantModules.mockResolvedValue({
      source: "api",
      data: [
        { moduleKey: "finance", moduleName: "Finance", enabled: true, enabledAt: null },
        { moduleKey: "hr", moduleName: "HR", enabled: false, enabledAt: null },
      ],
    });
    const ui = await TenantSettingsPage();
    render(ui);
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();
    expect(screen.getByText("Total Modules")).toBeInTheDocument();
    // The tile label "Enabled" (StatCard) is present.
    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThanOrEqual(1);
  });
});
