import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getGrantsDashboardMock = vi.fn();
const getGrantsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantsDashboard: () => getGrantsDashboardMock(),
  getGrants: () => getGrantsMock(),
}));

import GrantsDashboardPage from "./page";

describe("GrantsDashboardPage", () => {
  beforeEach(() => {
    getGrantsDashboardMock.mockReset();
    getGrantsMock.mockReset();
    getGrantsDashboardMock.mockResolvedValue({
      data: { totalGrants: 2, disbursedAmount: 300, pendingUCs: 4, totalGrantees: 7 },
      source: "api",
    });
    getGrantsMock.mockResolvedValue({
      data: [
        { id: "g1", grantNo: "G1", title: "A", granteeName: "X", totalAmount: 1000, disbursedAmount: 100, pendingAmount: 900, sanctionDate: "2026-08-12", status: "active" },
        { id: "g2", grantNo: "G2", title: "B", granteeName: "Y", totalAmount: 2000, disbursedAmount: 200, pendingAmount: 1800, sanctionDate: "2026-08-12", status: "completed" },
      ],
      source: "api",
    });
  });

  // GAP-GRANTS-DASHBOARD-01: the figure is labelled by its real basis, not "FY".
  it("labels the sanctioned figure 'Total Sanctioned' (no fabricated FY)", async () => {
    render(await GrantsDashboardPage());
    expect(screen.getByText("Total Sanctioned")).toBeInTheDocument();
    expect(screen.queryByText(/Sanctioned \(FY\)/)).not.toBeInTheDocument();
  });

  // GAP-GRANTS-DASHBOARD-01: Disbursed equals the sum of the table's rows
  // (100 + 200 = ₹3.00 in paise-formatting), computed from the SAME grants.
  it("computes Disbursed from the grants rows, not the separate dashboard endpoint", async () => {
    render(await GrantsDashboardPage());
    const labels = screen.getAllByText("Disbursed").filter((el) => el.classList.contains("lab"));
    expect(labels).toHaveLength(1);
    const disbursed = labels[0].closest(".stat")!;
    expect(within(disbursed as HTMLElement).getByText("₹3.00")).toBeInTheDocument();
  });

  // GAP-GRANTS-DASHBOARD-02: Total Grants + Grantees are now rendered.
  it("renders Total Grants and Grantees from the dashboard data", async () => {
    render(await GrantsDashboardPage());
    const totalGrants = screen.getByText("Total Grants").closest(".stat")!;
    expect(within(totalGrants as HTMLElement).getByText("2")).toBeInTheDocument();
    const grantees = screen.getByText("Grantees").closest(".stat")!;
    expect(within(grantees as HTMLElement).getByText("7")).toBeInTheDocument();
  });

  // GAP-GRANTS-DASHBOARD-04: back link + UC Pending drill-down.
  it("has a back link to /grants and links UC Pending to /grants/utilization", async () => {
    render(await GrantsDashboardPage());
    const back = screen.getByRole("link", { name: "Grants" });
    expect(back).toHaveAttribute("href", "/grants");
    const ucLink = screen.getByText("UC Pending").closest("a")!;
    expect(ucLink).toHaveAttribute("href", "/grants/utilization");
  });
});
