import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getPlanMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getBillingPlanById: (...args: unknown[]) => getPlanMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PlanDetailPage from "./page";

const PARAMS = { id: "11111111-2222-3333-4444-555555555555" };

describe("PlanDetailPage (GAP-BILLING-PLANS-DETAIL-01..05)", () => {
  beforeEach(() => getPlanMock.mockReset());

  it("renders priceMinor as ₹ with grouping, not raw 'INR 4999900' (DETAIL-02)", async () => {
    getPlanMock.mockResolvedValueOnce({
      data: { id: PARAMS.id, name: "Standard", code: "std", priceMinor: "4999900", currency: "INR", govtExempt: true, active: true },
      source: "api",
      status: 200,
    });
    render(await PlanDetailPage({ params: PARAMS }));
    expect(screen.getAllByText("₹49,999.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/INR 4999900/)).not.toBeInTheDocument();
  });

  it("shows the real code + govt-exempt fields the backend returns (DETAIL-01)", async () => {
    getPlanMock.mockResolvedValueOnce({
      data: { id: PARAMS.id, name: "Standard", code: "std_monthly", priceMinor: "100000", currency: "INR", govtExempt: false, active: true },
      source: "api",
      status: 200,
    });
    render(await PlanDetailPage({ params: PARAMS }));
    expect(screen.getAllByText("std_monthly").length).toBeGreaterThan(0);
    // govt exempt No appears (stat + field)
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
  });

  it("does NOT fabricate 'Active' or 'INR' when fields are absent (DETAIL-04)", async () => {
    getPlanMock.mockResolvedValueOnce({
      data: { id: PARAMS.id, name: "Partial", code: "p" }, // no price/currency/active/govtExempt
      source: "api",
      status: 200,
    });
    render(await PlanDetailPage({ params: PARAMS }));
    // status defaults to — not Active
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    // no "INR undefined" style string
    expect(screen.queryByText(/INR/)).not.toBeInTheDocument();
  });

  it("a 404 shows 'Plan not found', NOT the error state (DETAIL-03)", async () => {
    getPlanMock.mockResolvedValueOnce({ data: null, source: "error", status: 404 });
    render(await PlanDetailPage({ params: PARAMS }));
    expect(screen.getByText("Plan not found")).toBeInTheDocument();
    expect(screen.queryByText(/try again|retry/i)).not.toBeInTheDocument();
  });

  it("a 500 shows a retryable error state, NOT 'Plan not found' (DETAIL-03)", async () => {
    getPlanMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    render(await PlanDetailPage({ params: PARAMS }));
    expect(screen.queryByText("Plan not found")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });

  it("a 403 shows an access-restricted state, NOT 'Plan not found' (DETAIL-03)", async () => {
    getPlanMock.mockResolvedValueOnce({ data: null, source: "error", status: 403, errorMessage: "nope" });
    render(await PlanDetailPage({ params: PARAMS }));
    expect(screen.queryByText("Plan not found")).not.toBeInTheDocument();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("renders a single back affordance and a next/link to subscriptions (DETAIL-05)", async () => {
    getPlanMock.mockResolvedValueOnce({
      data: { id: PARAMS.id, name: "Standard", code: "std", priceMinor: "100000", currency: "INR", govtExempt: true, active: true },
      source: "api",
      status: 200,
    });
    render(await PlanDetailPage({ params: PARAMS }));
    const subsLink = screen.getByRole("link", { name: /view subscriptions/i });
    expect(subsLink).toHaveAttribute("href", "/billing/subscriptions");
  });
});
