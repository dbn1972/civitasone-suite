import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getSessionRolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => getSessionRolesMock() };
});

// The self-service card filters by tenant modules; never hit the real loader here.
const getEnabledModulesMock = vi.fn(async () => null as string[] | null);
vi.mock("@/lib/moduleVisibility", () => ({ getEnabledModules: () => getEnabledModulesMock() }));

// Child components are "use client" and tested on their own; stub them so this
// test isolates the page's module-tile and empty-state logic.
vi.mock("./SelfServiceCard", () => ({
  SelfServiceCard: (p: { enabledModules?: string[] | null }) => <div data-testid="self-service" data-mods={JSON.stringify(p.enabledModules ?? null)} />,
}));
vi.mock("./FirstRunTour", () => ({ FirstRunTour: () => null }));
vi.mock("../../_components/ActivationTracker", () => ({ ActivationTracker: () => null }));
vi.mock("./RoleCommandCenter", () => ({ RoleCommandCenter: () => null }));

import DashboardPage from "./page";
import { visibleModules } from "./visibleModules";

function renderDashboard() {
  return DashboardPage().then((ui) =>
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>),
  );
}

describe("DashboardPage module visibility", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReset();
  });

  it("GAP-DASHBOARD-HOME-2-02: a cadre role like 'chr_manager' does NOT see the HR tile", () => {
    const mods = visibleModules(["chr_manager"]);
    expect(mods.some((m) => m.label === "HR & Payroll")).toBe(false);
  });

  it("GAP-DASHBOARD-HOME-2-02: an 'hr_officer' DOES see the HR tile", () => {
    const mods = visibleModules(["hr_officer"]);
    expect(mods.some((m) => m.label === "HR & Payroll")).toBe(true);
  });

  it("GAP-DASHBOARD-HOME-2-03: a 'court_officer' sees the Court tile", async () => {
    getSessionRolesMock.mockReturnValue(["court_officer"]);
    await renderDashboard();
    expect(screen.getByRole("link", { name: "Court Mgmt" })).toBeInTheDocument();
  });

  it("GAP-DASHBOARD-HOME-2-03: role-less modules (Knowledge/Notifications) always show for a signed-in user", async () => {
    getSessionRolesMock.mockReturnValue(["court_officer"]);
    await renderDashboard();
    expect(screen.getByRole("link", { name: "Knowledge" })).toBeInTheDocument();
  });

  // UAT b23: reports/layout.tsx redirects everyone outside REPORTS_READER_ROLES, so the tile was a dead end for them.
  // (Replaces the Reports half of the GAP-DASHBOARD-HOME-2-03 assertion above, which asserted the dead-end tile.)
  it("UAT b23: the Reports tile shows only to report readers, not to a plain employee or court officer", async () => {
    expect(visibleModules(["employee"]).some((m) => m.href === "/reports")).toBe(false);
    expect(visibleModules(["court_officer"]).some((m) => m.href === "/reports")).toBe(false);
    for (const r of ["report_user", "report_viewer", "report_admin", "finance_admin", "tenant_admin", "super_admin"]) {
      expect(visibleModules([r]).some((m) => m.href === "/reports"), r).toBe(true);
    }
  });

  // UAT b23: "My approvals" pointed at the /workflow analytics hub (refused for most approvers).
  it("UAT b23: My approvals opens the /approvals inbox for a role that can read tasks", async () => {
    getSessionRolesMock.mockReturnValue(["procurement_officer"]);
    await renderDashboard();
    expect(screen.getByRole("link", { name: enMessages.home.myApprovals })).toHaveAttribute("href", "/approvals");
  });

  it("UAT b23: an analytics-only role (tenant_admin) gets the /workflow hub link", async () => {
    getSessionRolesMock.mockReturnValue(["tenant_admin"]);
    await renderDashboard();
    expect(screen.getByRole("link", { name: enMessages.home.myApprovals })).toHaveAttribute("href", "/workflow");
  });

  it("UAT b23: My approvals is not offered to a role the inbox would turn away", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    await renderDashboard();
    expect(screen.queryByRole("link", { name: enMessages.home.myApprovals })).not.toBeInTheDocument();
  });

  it("super_admin sees every module", () => {
    const mods = visibleModules(["super_admin"]);
    expect(mods.length).toBeGreaterThanOrEqual(30);
  });

  it("GAP-DASHBOARD-HOME-2-04: roles===[] renders the sign-in-again message, not the access-request message", async () => {
    getSessionRolesMock.mockReturnValue([]);
    await renderDashboard();
    expect(screen.getByText(enMessages.home.sessionUnreadable)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: enMessages.home.signInAgain })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByText(enMessages.home.noModules)).not.toBeInTheDocument();
  });

  it("passes the tenant module list to the employee self-service card (PR #2461 should-fix 2)", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    getEnabledModulesMock.mockResolvedValue(["smart-transfer"]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>{await DashboardPage()}</NextIntlClientProvider>,
    );
    const card = container.querySelector("[data-testid='self-service']");
    expect(card).not.toBeNull();
    expect(JSON.parse(card!.getAttribute("data-mods")!)).toEqual(["smart-transfer"]);
  });
});
