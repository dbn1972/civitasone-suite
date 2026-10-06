import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getProcurementAnnualPlanById: (id: string) => loaderMock(id),
}));
// PlanLifecycleActions pulls in session + toast; stub it to isolate the page.
vi.mock("./PlanLifecycleActions", () => ({
  PlanLifecycleActions: () => null,
}));

import AnnualPlanDetailPage from "./page";

const TENDER_ID = "11111111-2222-3333-4444-555555555555";

const PLAN = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  planNo: "APP/2026/001",
  planYear: 2026,
  title: "FY26 IT plan",
  department: "IT",
  status: "approved",
  currency: "INR",
  totalEstimatedMinor: "15000000",
  notes: null,
  submittedBy: "6a6a6a6a-0000-4000-8000-000000000001",
  submittedAt: "2026-01-02T04:30:00.000Z",
  approvedBy: "6a6a6a6a-0000-4000-8000-000000000002",
  approvedAt: "2026-01-03T04:30:00.000Z",
  rejectedReason: null,
  lines: [
    {
      id: "line-1", itemCode: "LAP-01", description: "Laptop", aggregatedQty: 2, uom: "nos",
      procurementCategory: "goods", procurementMethod: "gem", budgetLine: "2059-01",
      estimatedValueMinor: "10000000", timelineQuarter: "Q1", packageGroup: "PKG-A", tenderId: TENDER_ID,
    },
    {
      id: "line-2", itemCode: "PRN-01", description: "Printer", aggregatedQty: 1, uom: "nos",
      procurementCategory: "works", procurementMethod: "limited_tender", budgetLine: null,
      estimatedValueMinor: "5000000", timelineQuarter: null, packageGroup: null, tenderId: null,
    },
  ],
};

describe("AnnualPlanDetailPage (GAP-PROCUREMENT-PLANNING-DETAIL-02/03/05)", () => {
  beforeEach(() => loaderMock.mockReset());

  it("renders an approval history card with approver + timestamp", async () => {
    loaderMock.mockResolvedValue({ data: PLAN, source: "api" });
    render(await AnnualPlanDetailPage({ params: { id: PLAN.id } }));
    expect(screen.getByText("Approval history")).toBeInTheDocument();
    expect(screen.getByText("Approved by")).toBeInTheDocument();
    expect(screen.getByText(PLAN.approvedBy)).toBeInTheDocument();
  });

  it("renders budget line / category columns and a tender link for a linked line", async () => {
    loaderMock.mockResolvedValue({ data: PLAN, source: "api" });
    render(await AnnualPlanDetailPage({ params: { id: PLAN.id } }));
    // Budget line value appears.
    expect(screen.getByText("2059-01")).toBeInTheDocument();
    // The line with a tenderId links to the tender detail.
    const link = screen.getByRole("link", { name: /Open LAP-01/i });
    expect(link).toHaveAttribute("href", `/procurement/tenders/${TENDER_ID}`);
  });

  it("formats money as paise-exact and shows no totals-mismatch when lines sum to the total", async () => {
    loaderMock.mockResolvedValue({ data: PLAN, source: "api" });
    render(await AnnualPlanDetailPage({ params: { id: PLAN.id } }));
    // 15000000 paise → ₹1,50,000.00
    expect(screen.getAllByText("₹1,50,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Totals mismatch/i)).not.toBeInTheDocument();
  });

  it("flags a totals mismatch when the stored total disagrees with the line sum", async () => {
    loaderMock.mockResolvedValue({ data: { ...PLAN, totalEstimatedMinor: "99999999" }, source: "api" });
    render(await AnnualPlanDetailPage({ params: { id: PLAN.id } }));
    expect(screen.getByText(/Totals mismatch/i)).toBeInTheDocument();
  });
});
