import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { IssuesTable } from "./IssuesTable";
import type { LibraryIssueSummary } from "@civitasone/types";

const rows: LibraryIssueSummary[] = [
  {
    id: "i1",
    bookId: "b1",
    bookTitle: "Manual of Office Procedure",
    borrowerRef: "00000000-0000-0000-0000-000000000001",
    issuedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-15T00:00:00.000Z",
    status: "issued",
  },
];

describe("IssuesTable — return action", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("names the book and borrower in the confirm dialog, then returns it (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "i1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<IssuesTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Return Manual of Office Procedure/ }));

    await waitFor(() => expect(screen.getByText("Mark this book returned?")).toBeInTheDocument());
    expect(screen.getAllByText(/00000000-0000-0000-0000-000000000001/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Confirm return"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "issue not found" }), { status: 404 }),
    );

    render(<IssuesTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Return Manual of Office Procedure/ }));

    await waitFor(() => expect(screen.getByText("Mark this book returned?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm return"));

    await waitFor(() => {
      expect(screen.getByText(/NOT_FOUND: issue not found/)).toBeInTheDocument();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
