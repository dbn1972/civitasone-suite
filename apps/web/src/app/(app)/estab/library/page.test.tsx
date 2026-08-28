import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LibraryPage from "./page";

const oneBook = {
  data: [
    {
      id: "b1",
      accessionNo: "ACC-001",
      title: "Manual of Office Procedure",
      author: "GoI",
      isbn: "978-0000000000",
      category: "reference",
      copiesTotal: 3,
      copiesAvailable: 2,
      status: "available" as const,
    },
  ],
  source: "api" as const,
};

describe("LibraryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the catalogue list", async () => {
    fetchJsonMock.mockResolvedValueOnce(oneBook);

    const ui = await LibraryPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Manual of Office Procedure")).toBeInTheDocument();
    expect(screen.getByText("Staff Library")).toBeInTheDocument();
  });

  it("renders an empty state when the catalogue is genuinely empty", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await LibraryPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No books in the catalogue")).toBeInTheDocument();
  });

  it("shows the data-source badge (not an empty state) when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await LibraryPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("No books in the catalogue")).not.toBeInTheDocument();
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });
});
