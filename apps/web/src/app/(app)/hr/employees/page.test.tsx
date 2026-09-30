import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeesMock = vi.fn();
const getHRDashboardMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getEmployees: (...args: unknown[]) => getEmployeesMock(...args),
  getHRDashboard: (...args: unknown[]) => getHRDashboardMock(...args),
}));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import EmployeeDirectoryPage from "./page";

const DASHBOARD_EMPTY = {
  headcount: 0, onLeave: 0, employeeTypeBreakdown: [] as Array<{ name: string; count: number }>,
};

async function renderPage(searchParams?: Record<string, string>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await EmployeeDirectoryPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

describe("EmployeeDirectoryPage", () => {
  beforeEach(() => {
    getEmployeesMock.mockReset();
    getHRDashboardMock.mockReset();
    getHRDashboardMock.mockResolvedValue({ data: DASHBOARD_EMPTY, source: "api" });
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-EMPLOYEES-04: search must reach the backend across the whole
  // tenant, not just whatever 50 rows happen to be on the current page.
  describe("server-side search (GAP-HR-EMPLOYEES-04)", () => {
    it("forwards ?q= to getEmployees", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({ q: "Rashmi" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, "Rashmi");
    });

    it("does not forward an empty search string as a real query", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({});
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, undefined);
    });

    it("finds an employee whose row is on a later server page when searching (regression: used to only ever see the current 50-row page)", async () => {
      getEmployeesMock.mockResolvedValue({
        data: [{ id: "e1", name: "Rashmi Ranjan Das", department: "Finance", status: "confirmed" }],
        source: "api",
      });
      await renderPage({ q: "Rashmi", page: "3" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 150, undefined, "Rashmi");
      expect(screen.getByText("Rashmi Ranjan Das")).toBeInTheDocument();
    });

    it("renders a Clear link only when a search is active", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({ q: "Rashmi" });
      expect(screen.getByRole("link", { name: "Clear" })).toBeInTheDocument();
    });
  });

  it("shows the honest empty state (Total: 0) for a genuinely empty, un-searched roster", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({});
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("does not zero out the total for an empty search result (a real, narrow match set, not an empty roster)", async () => {
    getHRDashboardMock.mockResolvedValue({ data: { ...DASHBOARD_EMPTY, headcount: 214 }, source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ q: "Nobody Matches This" });
    // "214" appears both in the Total stat card and the "All (214)" tab label.
    expect(screen.getAllByText("214").length).toBeGreaterThan(0);
  });
});
