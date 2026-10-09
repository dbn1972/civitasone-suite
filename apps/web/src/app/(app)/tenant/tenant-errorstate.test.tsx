import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * GAP2-TENANT-ERRORSTATE-03 — the /tenant/* list pages passed `source` but
 * omitted `errorArea`, so a failed loader rendered the generic "We couldn't
 * load information/records" with no hint which office data failed. Each page
 * now passes a specific `errorArea`. With the loader forced into the error
 * state (source:"error", no cache), the error copy must name the office data,
 * NOT fall back to the generic "records"/"information".
 *
 * FAILS on the old pages: errorArea was absent, so ModuleListTable defaulted to
 * "records" and the specific-noun assertions below would not match.
 */

// Force the "hard failure, nothing cached" branch in ModuleListTable.
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: () => ({
    data: [],
    provenance: "error-no-data",
    offline: false,
    cachedAt: null,
    fromCache: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Every tenant loader resolves to an error source with no rows.
vi.mock("../_data", () => ({
  getTenantOverview: async () => ({ data: [], source: "error" }),
  getTenantSettings: async () => ({ data: [], source: "error" }),
  getTenantPositions: async () => ({ data: [], source: "error" }),
  getTenantQuotas: async () => ({ data: [], source: "error" }),
  getTenantStewardship: async () => ({ data: [], source: "error" }),
  getTenantSubscriptions: async () => ({ data: [], source: "error" }),
  getTenantCodeLists: async () => ({ data: [], source: "error" }),
  getTenantOrgHierarchy: async () => ({ data: [], source: "error" }),
  getTenantConsentExchange: async () => ({ data: [], source: "error" }),
  getTenantDataMigration: async () => ({ data: [], source: "error" }),
  getTenantPlans: async () => ({ data: [], source: "error" }),
}));

import SettingsPage from "./settings/page";
import PositionsPage from "./positions/page";
import CodeListsPage from "./code-lists/page";
import OverviewPage from "./overview/page";

describe("GAP2-TENANT-ERRORSTATE-03: tenant pages carry a specific errorArea", () => {
  it("settings page error names 'settings', not the generic 'records'", async () => {
    render(await SettingsPage());
    expect(screen.getByText(/We couldn't load settings\./i)).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load records\./i)).not.toBeInTheDocument();
    cleanup();
  });

  it("positions page error names 'positions'", async () => {
    render(await PositionsPage());
    expect(screen.getByText(/We couldn't load positions\./i)).toBeInTheDocument();
    cleanup();
  });

  it("code-lists page error names 'code lists'", async () => {
    render(await CodeListsPage());
    expect(screen.getByText(/We couldn't load code lists\./i)).toBeInTheDocument();
    cleanup();
  });

  it("overview page error names 'office profile'", async () => {
    render(await OverviewPage());
    expect(screen.getByText(/We couldn't load office profile\./i)).toBeInTheDocument();
    cleanup();
  });
});
