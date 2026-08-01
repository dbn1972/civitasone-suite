import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import QuartersPage from "./page";

const QUARTER = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  quarterNo: "B-14",
  quarterType: "type_iv",
  category: "general",
  address: "Sector 12",
  locality: "Sector 12",
  carpetAreaSqft: 850,
  status: "vacant",
  condition: "good",
  orgUnit: null,
  version: 1,
};

describe("QuartersPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the quarters list", async () => {
    fetchJsonMock.mockResolvedValue({ data: [QUARTER], source: "api" });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText("B-14")).toBeInTheDocument();
  });

  it("renders an empty state when there are no quarters", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getByText("No quarters yet")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await QuartersPage();
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
    expect(screen.queryByText("No quarters yet")).not.toBeInTheDocument();
  });
});
