import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// GAP-ESTAB-LIBRARY-05: control the viewer's roles for the add-form gate.
const rolesMock = vi.fn<() => string[]>(() => ["estab_officer"]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return {
    ...actual,
    getSessionRoles: () => rolesMock(),
  };
});

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
    rolesMock.mockReturnValue(["estab_officer"]);
  });

  it("renders the catalogue list", async () => {
    fetchJsonMock.mockResolvedValueOnce(oneBook);

    const ui = await LibraryPage();
    render(ui);

    expect(screen.getByText("Manual of Office Procedure")).toBeInTheDocument();
    expect(screen.getByText("Staff Library")).toBeInTheDocument();
  });

  it("renders an empty state when the catalogue is genuinely empty", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await LibraryPage();
    render(ui);

    expect(screen.getByText("No books in the catalogue")).toBeInTheDocument();
  });

  it("shows the data-source badge (not an empty state) when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await LibraryPage();
    render(ui);

    expect(screen.queryByText("No books in the catalogue")).not.toBeInTheDocument();
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("GAP-ESTAB-LIBRARY-01: shows a retry error state in the Catalogue card and hides the add form on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await LibraryPage();
    render(ui);

    // RefreshErrorState renders a "Try again" control.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The add form must not render while the catalogue is unloaded.
    expect(screen.queryByLabelText("Add a book to the library catalogue")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Book" })).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-02: loads the full catalogue without a server-side q/status filter", async () => {
    const twoBooks = {
      data: [
        { ...oneBook.data[0], id: "b1", status: "available" as const },
        { ...oneBook.data[0], id: "b2", title: "Out Book", status: "unavailable" as const, copiesAvailable: 0 },
      ],
      source: "api" as const,
    };
    fetchJsonMock.mockResolvedValueOnce(twoBooks);

    const ui = await LibraryPage();
    render(ui);

    expect(screen.getByText("Titles")).toBeInTheDocument();
    const calledUrl = String(fetchJsonMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).not.toMatch(/status=/);
    expect(calledUrl).not.toMatch(/search=/);
  });

  it("GAP-ESTAB-LIBRARY-05: hides the Add-a-Book form from a non-librarian viewer", async () => {
    rolesMock.mockReturnValue(["estab_reader"]);
    fetchJsonMock.mockResolvedValueOnce(oneBook);

    const ui = await LibraryPage();
    render(ui);

    expect(screen.queryByRole("button", { name: "Add Book" })).not.toBeInTheDocument();
    // Catalogue still renders for readers.
    expect(screen.getByText("Manual of Office Procedure")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-05: shows the Add-a-Book form to a librarian", async () => {
    rolesMock.mockReturnValue(["estab_officer"]);
    fetchJsonMock.mockResolvedValueOnce(oneBook);

    const ui = await LibraryPage();
    render(ui);

    expect(screen.getByRole("button", { name: "Add Book" })).toBeInTheDocument();
  });
});
