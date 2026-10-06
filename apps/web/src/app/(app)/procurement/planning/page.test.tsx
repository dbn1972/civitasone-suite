import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getProcurementAnnualPlans: (q?: unknown) => loaderMock(q),
}));

import AnnualProcurementPlanPage from "./page";

const PLAN = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  planNo: "APP/2026/001",
  planYear: 2026,
  title: "FY26 IT plan",
  department: "IT",
  status: "pending",
  totalEstimatedMinor: 1234567,
  itemCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AnnualProcurementPlanPage (GAP-PROCUREMENT-PLANNING-01/02/03/04/05)", () => {
  beforeEach(() => {
    loaderMock.mockReset();
  });

  it("shows the human planNo (not a UUID fragment), an Items count, formatted money and a status label", async () => {
    loaderMock.mockResolvedValue({ data: [PLAN], source: "api" });
    const ui = await AnnualProcurementPlanPage({ searchParams: {} });
    render(ui);

    // planNo visible; UUID fragment NOT shown.
    expect(screen.getByText("APP/2026/001")).toBeInTheDocument();
    expect(screen.queryByText(PLAN.id.slice(0, 8))).not.toBeInTheDocument();
    // Items count.
    expect(screen.getByText("3")).toBeInTheDocument();
    // Money via formatMoney (paise exact): 1234567 → ₹12,345.67.
    expect(screen.getByText("₹12,345.67")).toBeInTheDocument();
    // Status label (StatusPill via statusLabels), not raw "pending".
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    // Row links to the detail page.
    const link = screen.getByRole("link", { name: /Open APP\/2026\/001/i });
    expect(link).toHaveAttribute("href", `/procurement/planning/${PLAN.id}`);
  });

  it("passes the year filter from searchParams to the loader", async () => {
    loaderMock.mockResolvedValue({ data: [PLAN], source: "api" });
    const ui = await AnnualProcurementPlanPage({ searchParams: { year: "2026" } });
    render(ui);
    expect(loaderMock).toHaveBeenCalledWith(expect.objectContaining({ year: 2026 }));
  });

  it("shows a filter-specific empty state when a filter matches nothing", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await AnnualProcurementPlanPage({ searchParams: { department: "Nope" } });
    render(ui);
    expect(screen.getByText(/No plans match this filter/i)).toBeInTheDocument();
  });

  it("renders a RefreshErrorState on loader error (not a fabricated empty list)", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AnnualProcurementPlanPage({ searchParams: {} });
    const { container } = render(ui);
    expect(within(container).queryByText(/No plans yet/i)).not.toBeInTheDocument();
  });
});
