import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { IngestChallanForm } from "./IngestChallanForm";

describe("IngestChallanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid 7-digit BSR code before opening the confirm dialog", () => {
    render(<IngestChallanForm period="2026-06" />);
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));
    expect(screen.getByText("BSR code must be a 7-digit RBI code.")).toBeInTheDocument();
  });

  it("ingests a challan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "challan ingested", cin: "C1" }), { status: 201 }),
    );

    render(<IngestChallanForm period="2026-06" />);
    fireEvent.change(screen.getByLabelText(/BSR Code/), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText(/Challan Serial/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Deposit Date/), { target: { value: "2026-06-07" } });
    fireEvent.change(screen.getByLabelText(/TDS Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));

    await waitFor(() => expect(screen.getByText("Ingest this TDS challan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Ingest"));

    await waitFor(() => {
      expect(screen.getByText(/Challan ingested for 2026-06\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    render(<IngestChallanForm period="2026-06" />);
    fireEvent.change(screen.getByLabelText(/BSR Code/), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText(/Challan Serial/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Deposit Date/), { target: { value: "2026-06-07" } });
    fireEvent.change(screen.getByLabelText(/TDS Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));

    await waitFor(() => expect(screen.getByText("Ingest this TDS challan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Ingest"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 409/)).toBeInTheDocument();
    });
  });
});
