import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceSchemeByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinanceSchemeById: (...args: unknown[]) => getFinanceSchemeByIdMock(...args),
}));

import SchemeDetailPage from "./page";

const SCHEME = {
  id: "s1",
  code: "TESTSCHEME",
  name: "Rural Connectivity Test Scheme",
  outlayMinor: "1000000000",
  utilisedMinor: "400000000",
  currency: "INR",
  funding: "Central",
  status: "active",
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  version: 1,
};

// Regression test for the CRITICAL L3 gap: this page used to render 100%
// hardcoded fake data ("PM Gram Sadak Yojana", fixed Cr figures, fabricated
// milestone and fund-release tables) and never read params.id at all. It
// must now call the real per-id loader with the route id and render its
// data — and must never show any of the old fabricated constants.
describe("SchemeDetailPage", () => {
  beforeEach(() => {
    getFinanceSchemeByIdMock.mockReset();
  });

  it("fetches the scheme by the route id and renders real data", async () => {
    getFinanceSchemeByIdMock.mockResolvedValue({ data: SCHEME, source: "api" });

    const ui = await SchemeDetailPage({ params: { id: "s1" } });
    render(ui);

    expect(getFinanceSchemeByIdMock).toHaveBeenCalledWith("s1");
    expect(screen.getAllByText(SCHEME.name).length).toBeGreaterThan(0);
    expect(screen.getByText("TESTSCHEME")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();

    // None of the old hardcoded fixture values should ever appear.
    expect(screen.queryByText("PM Gram Sadak Yojana")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹2,500 Cr/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 1 — DPR Preparation/)).not.toBeInTheDocument();
  });

  it("shows an honest empty state instead of fake data when no record is found", async () => {
    getFinanceSchemeByIdMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await SchemeDetailPage({ params: { id: "does-not-exist" } });
    render(ui);

    expect(getFinanceSchemeByIdMock).toHaveBeenCalledWith("does-not-exist");
    expect(screen.getByText("Scheme detail not available")).toBeInTheDocument();
    expect(screen.queryByText("PM Gram Sadak Yojana")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ministry of Rural Development/)).not.toBeInTheDocument();
  });
});
