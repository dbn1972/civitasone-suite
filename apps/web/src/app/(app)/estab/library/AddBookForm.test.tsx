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
      expect(screen.getByText(/Book submitted/)).toBeInTheDocument();
    });
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
      expect(screen.getByText(/VALIDATION_FAILED: invalid request/)).toBeInTheDocument();
    });
  });
});
