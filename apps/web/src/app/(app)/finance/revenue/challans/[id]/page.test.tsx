import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceChallanByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinanceChallanById: (...args: unknown[]) => getFinanceChallanByIdMock(...args),
}));

import ChallanDetailPage from "./page";

const CHALLAN = {
  id: "c1",
  challanNo: "CHN/2026/00042",
  receiptHeadId: "0030-stamps",
  depositor: "Sh. Arun Mishra, Accounts Officer",
  amountMinor: "150000000",
  currency: "INR",
  grnNo: "GRN-2026-0099",
  status: "verified",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  version: 1,
};

// Regression test for the CRITICAL L3 gap: this page used to render 100%
// hardcoded fake data ("CHN/2024/001", "SBI", "Civil Lines, Lucknow", a fixed
// amount breakdown, ...) and never read params.id at all. It must now call
// the real per-id loader with the route id and render its data — and must
// never show any of the old fabricated constants.
describe("ChallanDetailPage", () => {
  beforeEach(() => {
    getFinanceChallanByIdMock.mockReset();
  });

  it("fetches the challan by the route id and renders real data", async () => {
    getFinanceChallanByIdMock.mockResolvedValue({ data: CHALLAN, source: "api" });

    const ui = await ChallanDetailPage({ params: { id: "c1" } });
    render(ui);

    expect(getFinanceChallanByIdMock).toHaveBeenCalledWith("c1");
    expect(screen.getAllByText(/CHN\/2026\/00042/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Arun Mishra/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("GRN-2026-0099").length).toBeGreaterThan(0);

    // None of the old hardcoded fixture values should ever appear.
    expect(screen.queryByText(/CHN\/2024\/001/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Civil Lines, Lucknow/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stamp Duty — Residential/)).not.toBeInTheDocument();
  });

  it("shows an honest empty state instead of fake data when no record is found", async () => {
    getFinanceChallanByIdMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await ChallanDetailPage({ params: { id: "does-not-exist" } });
    render(ui);

    expect(getFinanceChallanByIdMock).toHaveBeenCalledWith("does-not-exist");
    expect(screen.getByText("Challan detail not available")).toBeInTheDocument();
    expect(screen.queryByText(/CHN\/2024\/001/)).not.toBeInTheDocument();
    expect(screen.queryByText("₹15,00,000")).not.toBeInTheDocument();
  });
});
