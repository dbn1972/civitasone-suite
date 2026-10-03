import { describe, it, expect, vi, beforeEach } from "vitest";

// GAP-ADMIN-HOME-01 / OPERATORS-01 / API-MONITORING-01 / CONFIG-02 / ORG-01 /
// ROLE-FEATURES-01 / ROLES-01 / SCHEDULED-JOBS-02 / INTEGRATIONS-01 /
// SETTINGS-02 / USERS-01: each admin route now enforces the same role list its
// backing service enforces, instead of rendering for any signed-in user.
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  getSessionTenantId: () => "t1",
  getSessionUserId: () => "u1",
  requireAnyRole: (allowed: string[]) => {
    if (!allowed.some((r) => mockRoles.includes(r))) throw new Error("REDIRECT");
  },
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin" }));

import AdminHubPage from "./page";
import OperatorsPage from "./operators/page";
import ApiMonitoringPage from "./api-monitoring/page";
import ScheduledJobsPage from "./scheduled-jobs/page";
import OrgPage from "./org/page";
import RoleFeaturesPage from "./role-features/page";
import RolesPage from "./roles/page";
import UsersPage from "./users/page";
import IntegrationsPage from "./integrations/page";
import SettingsPage from "./settings/page";
import ConfigPage from "./config/page";

type PageFn = () => unknown | Promise<unknown>;
const platformOnly: [string, PageFn][] = [
  ["operators", OperatorsPage],
  ["api-monitoring", ApiMonitoringPage],
  ["scheduled-jobs", ScheduledJobsPage],
  ["config", ConfigPage],
];
const tenantAdmin: [string, PageFn][] = [
  ["admin hub", AdminHubPage],
  ["org", OrgPage],
  ["role-features", RoleFeaturesPage],
  ["roles", RolesPage],
  ["users", () => UsersPage({})],
  ["integrations", IntegrationsPage],
  ["settings", SettingsPage],
];

describe("admin route role gates", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); fetchJsonMock.mockResolvedValue({ data: [], source: "api" }); });

  for (const [name, page] of [...platformOnly, ...tenantAdmin]) {
    it(`${name}: an employee is redirected before any data is fetched`, async () => {
      mockRoles = ["employee"];
      await expect(Promise.resolve().then(page)).rejects.toThrow("REDIRECT");
      expect(fetchJsonMock).not.toHaveBeenCalled();
    });
  }

  for (const [name, page] of platformOnly) {
    it(`${name}: a tenant_admin is NOT let in (platform-operator console)`, async () => {
      mockRoles = ["tenant_admin"];
      await expect(Promise.resolve().then(page)).rejects.toThrow("REDIRECT");
    });
    it(`${name}: platform_admin passes the gate`, async () => {
      mockRoles = ["platform_admin"];
      await Promise.resolve().then(page).catch((e: Error) => expect(e.message).not.toBe("REDIRECT"));
    });
  }

  for (const [name, page] of tenantAdmin) {
    it(`${name}: tenant_admin passes the gate`, async () => {
      mockRoles = ["tenant_admin"];
      await Promise.resolve().then(page).catch((e: Error) => expect(e.message).not.toBe("REDIRECT"));
    });
  }
});
