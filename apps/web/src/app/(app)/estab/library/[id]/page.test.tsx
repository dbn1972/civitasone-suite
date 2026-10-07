import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["estab_officer"],
  hasAnyRole: () => true,
  ESTAB_LIBRARY_WRITE_ROLES: ["estab_officer", "estab_admin", "super_admin"],
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

  it("shows a retryable load error (NOT a false 'Book not found') when the fetch fails", async () => {
    // A 5xx / network error (no 404 status) must offer retry, not claim the
    // book does not exist.
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    expect(screen.queryByText("Book not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-DETAIL-03: renders a 'Book not found' EmptyState with a back action on a 404", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 404 });

    const ui = await LibraryBookDetailPage({ params: { id: "missing" } });
    render(ui);

    expect(screen.getAllByText("Book not found").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Back to catalogue" })).toBeInTheDocument();
    // Must NOT render the retry state for a genuine 404.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-DETAIL-01: shows edit + withdraw controls for a librarian", async () => {
    const allAvailable = {
      data: { ...availableBook.data, copiesTotal: 3, copiesAvailable: 3 },
      source: "api" as const,
    };
    fetchJsonMock.mockResolvedValueOnce(allAvailable);

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    expect(screen.getByRole("button", { name: "Edit book details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw this book" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw this book" })).not.toBeDisabled();
  });

  it("GAP-ESTAB-LIBRARY-DETAIL-01: withdraw is disabled while copies are out", async () => {
    // 3 total, 2 available → 1 copy out → withdraw must be blocked.
    const partialOut = {
      data: { ...availableBook.data, copiesTotal: 3, copiesAvailable: 2 },
      source: "api" as const,
    };
    fetchJsonMock.mockResolvedValueOnce(partialOut);

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    const withdrawBtn = screen.getByRole("button", { name: /Cannot withdraw: 1 copies are on loan/ });
    expect(withdrawBtn).toBeDisabled();
  });

  it("GAP-ESTAB-LIBRARY-DETAIL-01: a withdrawn book shows a withdrawn note, not issue/edit", async () => {
    const withdrawn = {
      data: { ...availableBook.data, status: "withdrawn" as const, copiesAvailable: 0 },
      source: "api" as const,
    };
    fetchJsonMock.mockResolvedValueOnce(withdrawn);

    const ui = await LibraryBookDetailPage({ params: { id: "b1" } });
    render(ui);

    expect(screen.getByText("This book has been withdrawn from the catalogue.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Issue this book" })).not.toBeInTheDocument();
  });
});
