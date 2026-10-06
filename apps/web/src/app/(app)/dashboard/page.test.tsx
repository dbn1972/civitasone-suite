import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getSessionRolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => getSessionRolesMock() };
});

// Child components are "use client" and tested on their own; stub them so this
// test isolates the page's module-tile and empty-state logic.
vi.mock("./FirstRunTour", () => ({ FirstRunTour: () => null }));
vi.mock("../../_components/ActivationTracker", () => ({ ActivationTracker: () => null }));
vi.mock("./RoleCommandCenter", () => ({ RoleCommandCenter: () => null }));

import DashboardPage, { visibleModules } from "./page";

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

  it("GAP-DASHBOARD-HOME-2-03: role-less modules (Reports/Knowledge/Notifications) always show for a signed-in user", async () => {
    getSessionRolesMock.mockReturnValue(["court_officer"]);
    await renderDashboard();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge" })).toBeInTheDocument();
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
});
