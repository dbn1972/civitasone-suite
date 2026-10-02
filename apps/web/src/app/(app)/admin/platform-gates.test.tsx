/**
 * h4-admin-platform-tenancy: role gates on the platform-operator pages.
 * A plain tenant user gets "Access restricted" and NO loader runs; a
 * platform admin gets the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSessionRolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(),
}));

import EditionsPage from "./editions/page";
import EntitlementsPage from "./entitlements/page";
import GatewaysPage from "./gateways/page";
import MeteringPage from "./metering/page";
import OnboardingPage from "./onboarding/page";
import TechAdminPage from "./tech-admin/page";
import TenantsPage from "./tenants/page";
import InvoicesPage from "./invoices/page";
import BulkScanPage from "./bulk-scan/page";
import DiscoveryPage from "./discovery/page";
import TenantProvisionPage from "./tenant-provision/page";
import SaDashboardPage from "./sa-dashboard/page";
import GatewayRoutesPage from "./gateway-routes/page";
import FeatureFlagsPage from "./feature-flags/page";
import GatewayConfigPage from "./gateway-config/page";
import TenantDetailPage from "./tenants/[id]/page";

type PageFn = () => unknown;
const PAGES: Array<[string, PageFn]> = [
  ["editions", EditionsPage],
  ["entitlements", EntitlementsPage],
  ["gateways", GatewaysPage],
  ["metering", MeteringPage],
  ["onboarding", OnboardingPage],
  ["tech-admin", TechAdminPage],
  ["tenants", TenantsPage],
  ["invoices", InvoicesPage],
  ["bulk-scan", BulkScanPage],
  ["discovery", DiscoveryPage],
  ["tenant-provision", TenantProvisionPage],
  ["sa-dashboard", SaDashboardPage],
  ["gateway-routes", GatewayRoutesPage],
  ["feature-flags", FeatureFlagsPage],
  ["gateway-config", GatewayConfigPage],
  ["tenants/[id]", () => TenantDetailPage({ params: Promise.resolve({ id: "t-1" }) })],
];

describe("platform admin page gates", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getSessionRolesMock.mockReset();
  });

  it.each(PAGES)("%s: an employee sees Access restricted and no loader runs", async (_name, Page) => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    render((await Page()) as React.ReactElement);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each(PAGES.filter(([n]) => n !== "invoices"))("%s: a tenant_admin is also refused", async (_name, Page) => {
    getSessionRolesMock.mockReturnValue(["tenant_admin"]);
    render((await Page()) as React.ReactElement);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("invoices: a tenant_admin (billing reader on the backend) is allowed", async () => {
    getSessionRolesMock.mockReturnValue(["tenant_admin"]);
    render((await InvoicesPage()) as React.ReactElement);
    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalled();
  });

  it("gateway-routes: api_admin is allowed (gateway-service catalogue ADMIN_ROLES)", async () => {
    getSessionRolesMock.mockReturnValue(["api_admin"]);
    render((await GatewayRoutesPage()) as React.ReactElement);
    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
  });

  it("editions: a platform_admin gets the page and the loader runs", async () => {
    getSessionRolesMock.mockReturnValue(["platform_admin"]);
    render((await EditionsPage()) as React.ReactElement);
    expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
    expect(screen.getByText("Edition Catalog")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalled();
  });
});
