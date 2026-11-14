import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";

const { getTenantModules, getCurrentTenantOrgType, getModuleSettings } = vi.hoisted(() => ({ getTenantModules: vi.fn(), getCurrentTenantOrgType: vi.fn(), getModuleSettings: vi.fn() }));
vi.mock("../../../_data/loaders", () => ({
  getTenantModules: () => getTenantModules(),
  getCurrentTenantOrgType: () => getCurrentTenantOrgType(),
  getModuleSettings: () => getModuleSettings(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import TenantSettingsPage from "./page";

afterEach(() => vi.clearAllMocks());
beforeEach(() => {
  getModuleSettings.mockResolvedValue({ source: "api", data: { source: "legacy", modules: [] } });
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

describe("TenantSettingsPage: module source (M4)", () => {
  const LEGACY_DATA = [{ moduleKey: "finance", moduleName: "Finance", enabled: true, enabledAt: null }];

  it("legacy (default): the older toggles are shown and the catalogue view is not", async () => {
    getTenantModules.mockResolvedValue({ source: "api", data: LEGACY_DATA });
    getModuleSettings.mockResolvedValue({ source: "api", data: { source: "legacy", modules: [] } });
    render(await TenantSettingsPage());
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByText("Module toggles")).toBeInTheDocument();
    expect(screen.queryByText(/managed from the module catalogue/i)).not.toBeInTheDocument();
  });

  it("the capability cannot be read: falls back to today's page", async () => {
    getTenantModules.mockResolvedValue({ source: "api", data: LEGACY_DATA });
    getModuleSettings.mockResolvedValue({ source: "error", data: { source: "legacy", modules: [] } });
    render(await TenantSettingsPage());
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("catalogue mode: uses the catalogue view (no Save changes / older toggles) and counts catalogue modules", async () => {
    getTenantModules.mockResolvedValue({ source: "api", data: LEGACY_DATA });
    getModuleSettings.mockResolvedValue({
      source: "api",
      data: {
        source: "catalogue",
        modules: [
          { id: "employee", name: "Employee Master", cluster: "hr", enabled: true, source: "user", hardDeps: [], softDeps: [], requiredBy: [] },
          { id: "payroll", name: "Payroll", cluster: "payroll", enabled: false, source: null, hardDeps: ["employee"], softDeps: [], requiredBy: [] },
        ],
      },
    });
    render(await TenantSettingsPage());
    expect(screen.getByText(/managed from the module catalogue/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Payroll module: Disabled/ })).toBeInTheDocument();
    expect(screen.getByText("Requires: Employee Master")).toBeInTheDocument();
  });
});
