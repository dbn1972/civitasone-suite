import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import VigilancePage from "./page";

const MOCK_ROWS = [{ id: "v1", inquiryStatus: "under_investigation", outcome: null }];

describe("VigilancePage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders vigilance cases and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await VigilancePage());
    expect(screen.getAllByText("Total Cases").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no vigilance cases", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await VigilancePage());
    expect(screen.getByText("No vigilance cases found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await VigilancePage());
    expect(screen.getByText("We couldn't load this vigilance cases.")).toBeInTheDocument();
    expect(screen.queryByText("No vigilance cases found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
