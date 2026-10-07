import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AddBookForm } from "./AddBookForm";

describe("AddBookForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires accession no, title and a positive copy count before submitting", () => {
    render(<AddBookForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add Book" }));
    expect(screen.getByText("Enter an accession number.")).toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-05: blocks submit when the accession number already exists", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AddBookForm existingAccessions={["ACC-001"]} />);
    fireEvent.change(screen.getByLabelText(/Accession No\./), { target: { value: "acc-001" } });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText(/^Copies/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Book" }));
    expect(screen.getByText("This accession number is already in the catalogue.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("adds a book on submit (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "book-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<AddBookForm />);
    fireEvent.change(screen.getByLabelText(/Accession No\./), { target: { value: "ACC-042" } });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Fundamental Rules" } });
    fireEvent.change(screen.getByLabelText(/^Copies/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Book" }));

    await waitFor(() => {
      expect(screen.getByText(/Added .*Fundamental Rules.* to the catalogue/)).toBeInTheDocument();
    });
    // GAP-ESTAB-LIBRARY-03: the raw record id must never appear in the message.
    expect(screen.queryByText(/book-1/)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on submit (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "invalid request" }), { status: 400 }),
    );

    render(<AddBookForm />);
    fireEvent.change(screen.getByLabelText(/Accession No\./), { target: { value: "ACC-042" } });
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Fundamental Rules" } });
    fireEvent.change(screen.getByLabelText(/^Copies/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Book" }));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/VALIDATION_FAILED/)).not.toBeInTheDocument();
  });
});
