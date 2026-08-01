import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LibraryBookDetailPage from "./page";

const availableBook = {
  data: {
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
  source: "api" as const,
};

const unavailableBook = {
  data: {
    ...availableBook.data,
    copiesAvailable: 0,
    status: "unavailable" as const,
  },
  source: "api" as const,
};

describe("LibraryBookDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the 'Issue this book' link when copies are available", async () => {
    fetchJsonMock.mockResolvedValueOnce(availableBook);

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    expect(screen.getByRole("link", { name: "Issue this book" })).toBeInTheDocument();
  });

  it("does NOT render the Issue CTA when copiesAvailable is 0 — shows a plain note instead", async () => {
    fetchJsonMock.mockResolvedValueOnce(unavailableBook);

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    expect(screen.queryByRole("link", { name: "Issue this book" })).not.toBeInTheDocument();
    expect(screen.getByText("No copies currently available to issue.")).toBeInTheDocument();
  });

  it("shows the not-found message when the book does not exist", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error" });

    const ui = await LibraryBookDetailPage({ params: { id: "unknown" } });
    render(ui);

    expect(screen.getByText("Book not found")).toBeInTheDocument();
    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });
});
