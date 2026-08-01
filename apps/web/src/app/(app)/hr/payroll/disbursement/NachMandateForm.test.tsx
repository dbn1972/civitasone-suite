import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { NachMandateForm } from "./NachMandateForm";

function fillMandateFields() {
  fireEvent.change(screen.getByLabelText(/Employee Reference/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "5000" } });
  fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/End Date/), { target: { value: "2027-08-01" } });
}

describe("NachMandateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    render(<NachMandateForm />);
    fireEvent.click(screen.getByText("Submit NACH Mandate"));
    expect(screen.getByText(/are required/)).toBeInTheDocument();
  });

  it("submits a mandate on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { umrn: "UMRN123", status: "submitted" } }), { status: 201 }),
    );

    render(<NachMandateForm />);
    fillMandateFields();
    fireEvent.click(screen.getByText("Submit NACH Mandate"));

    await waitFor(() => expect(screen.getByText("Submit this NACH mandate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit mandate"));

    await waitFor(() => {
      expect(screen.getByText(/Mandate submitted \(UMRN UMRN123/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the submit confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<NachMandateForm />);
    fillMandateFields();
    fireEvent.click(screen.getByText("Submit NACH Mandate"));

    await waitFor(() => expect(screen.getByText("Submit this NACH mandate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit mandate"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });

  it("requires a reference before checking mandate status", () => {
    render(<NachMandateForm />);
    fireEvent.click(screen.getByText("Check Status"));
    expect(screen.getByText("Enter a mandate reference to check its status.")).toBeInTheDocument();
  });

  it("checks mandate status on submit (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "active" } }), { status: 200 }),
    );

    render(<NachMandateForm />);
    fireEvent.change(screen.getByLabelText(/Check Mandate Status by Reference/), { target: { value: "REF-1" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("Status: active")).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the status lookup (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "mandate not found" } }), { status: 404 }),
    );

    render(<NachMandateForm />);
    fireEvent.change(screen.getByLabelText(/Check Mandate Status by Reference/), { target: { value: "REF-missing" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("mandate not found")).toBeInTheDocument();
    });
  });
});
