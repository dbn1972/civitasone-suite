import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LibraryIssuesPage from "./page";

const issuesPage = {
  data: [
    {
      id: "i1",
      bookId: "b1",
      bookTitle: "Manual of Office Procedure",
      borrowerRef: "00000000-0000-0000-0000-000000000001",
      issuedAt: "2026-07-01T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z",
      status: "issued" as const,
    },
  ],
  source: "api" as const,
};

const booksPage = {
  data: [
    {
      id: "b1",
      accessionNo: "ACC-001",
      title: "Manual of Office Procedure",
      copiesTotal: 3,
      copiesAvailable: 1,
      status: "available" as const,
    },
  ],
  source: "api" as const,
};

describe("LibraryIssuesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the loans list", async () => {
    fetchJsonMock.mockResolvedValueOnce(issuesPage).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.getAllByText("Manual of Office Procedure").length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are genuinely no loans", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" }).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No loans yet")).toBeInTheDocument();
  });

  it("shows the data-source badge (not an empty state) when the loans loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" }).mockResolvedValueOnce(booksPage);

    const ui = await LibraryIssuesPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText("No loans yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });
});
