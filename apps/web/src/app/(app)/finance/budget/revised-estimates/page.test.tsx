import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import RevisedEstimatesPage from "./page";

const MOCK_BUDGETS = [
  { id: "b1", majorHead: "2210", subHead: "Health", beMinor: 10000000, reMinor: 12000000 },
];

describe("RevisedEstimatesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the BE/RE table and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_BUDGETS, source: "api" });
    render(await RevisedEstimatesPage());
    expect(screen.getByText("Total Heads")).toBeInTheDocument();
    expect(screen.getByText("2210")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no budget heads (source: api, [])", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await RevisedEstimatesPage());
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state — not zero stat cards or the BE/RE table — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await RevisedEstimatesPage());
    expect(screen.getByText("We couldn't load this revised estimates.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  // UX-006: `toRow()` used to compute BE/RE via `Number(b.beMinor) / 100`,
  // which turns a missing beMinor into a real-looking 0 and an unparseable
  // one into NaN -- rendered as a fabricated "₹0.00" either way. A row with
  // null/missing beMinor must render "—" for BE and Variance %, never ₹0.00.
  it("renders an honest '—' for a row with a missing beMinor, never a fabricated ₹0.00 (UX-006)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "b1", majorHead: "2210", subHead: "Health", beMinor: 10000000, reMinor: 12000000 },
        { id: "b2", majorHead: "2211", subHead: "Family Welfare", beMinor: null, reMinor: 5000000 },
      ],
      source: "api",
    });
    render(await RevisedEstimatesPage());
    expect(screen.getByText("2211")).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
