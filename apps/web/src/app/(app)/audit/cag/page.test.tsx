import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import CagPage from "./page";

const MOCK_PARAS = [{ id: "p1", department: "Finance", totalParas: 5, settled: 2, pending: 3 }];

describe("CagPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders CAG paragraphs and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_PARAS, source: "api" });
    render(await CagPage());
    expect(screen.getAllByText("Total Paras").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no CAG paragraphs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await CagPage());
    expect(screen.getByText("No CAG paragraphs found")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await CagPage());
    expect(screen.getByText("We couldn't load this CAG audit paragraphs.")).toBeInTheDocument();
    expect(screen.queryByText("No CAG paragraphs found")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
