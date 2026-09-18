import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { IngestChallanForm } from "./IngestChallanForm";

// UX-017: IngestChallanForm now reads its copy through next-intl
// (useTranslations("ingestChallanForm")), so every render needs a real
// provider in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderForm(period = "2026-06") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <IngestChallanForm period={period} />
    </NextIntlClientProvider>,
  );
}

describe("IngestChallanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid 7-digit BSR code before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));
    expect(screen.getByText("BSR code must be a 7-digit RBI code.")).toBeInTheDocument();
  });

  it("ingests a challan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "challan ingested", cin: "C1" }), { status: 201 }),
    );

    renderForm();
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

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/BSR Code/), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText(/Challan Serial/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Deposit Date/), { target: { value: "2026-06-07" } });
    fireEvent.change(screen.getByLabelText(/TDS Amount/), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));

    await waitFor(() => expect(screen.getByText("Ingest this TDS challan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Ingest"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 409/)).not.toBeInTheDocument();
  });

  it("flags only the empty field(s) as aria-invalid when serial and/or date are missing, independent of locale text (UX-017 bug-class regression)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/BSR Code/), { target: { value: "1234567" } });
    fireEvent.change(screen.getByLabelText(/TDS Amount/), { target: { value: "500" } });
    // Leave both Challan Serial and Deposit Date empty -- both should be
    // flagged invalid simultaneously (the reason invalidFields is a Set).
    fireEvent.click(screen.getByRole("button", { name: "Ingest Challan" }));
    expect(screen.getByText("Challan serial and deposit date are required.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Challan Serial/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Deposit Date/)).toHaveAttribute("aria-invalid", "true");
    // BSR and TDS Amount were valid, so they must not be flagged.
    expect(screen.getByLabelText(/BSR Code/)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText(/TDS Amount/)).not.toHaveAttribute("aria-invalid");
  });
});
