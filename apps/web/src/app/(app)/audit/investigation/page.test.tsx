import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import InvestigationPage from "./page";

const MOCK_ROWS = [{ id: "i1", status: "in_progress" }];

describe("InvestigationPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders investigations and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await InvestigationPage());
    expect(screen.getAllByText("Active Investigations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no investigations", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await InvestigationPage());
    expect(screen.getByText("No investigations found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await InvestigationPage());
    expect(screen.getByText("We couldn't load this investigation cases.")).toBeInTheDocument();
    expect(screen.queryByText("No investigations found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
