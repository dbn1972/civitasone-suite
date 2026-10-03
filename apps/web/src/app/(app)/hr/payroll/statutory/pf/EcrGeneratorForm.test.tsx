import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EcrGeneratorForm } from "./EcrGeneratorForm";

// UX-017: EcrGeneratorForm now reads its copy through next-intl
// (useTranslations("ecrGeneratorForm")), so every render needs a real
// provider in the tree -- same pattern as
// corrections/CreateCorrectionForm.test.tsx (tranche 11).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EcrGeneratorForm />
    </NextIntlClientProvider>,
  );
}

describe("EcrGeneratorForm", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("requires a month before opening the confirm dialog", () => {
    renderForm();
    // GAP-PAYROLL-STATUTORY-PF-05: the field now defaults to the previous
    // calendar month (see the dedicated default test below), so exercising
    // the required-field validation needs an explicit clear first.
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));
    expect(screen.getByText("Month is required in YYYY-MM format.")).toBeInTheDocument();
  });

  it("defaults the period to the previous calendar month (GAP-PAYROLL-STATUTORY-PF-05)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // 15 Jun 2026 (local) -> previous month is 2026-05
    renderForm();
    expect(screen.getByLabelText(/^Period/)).toHaveValue("2026-05");
    vi.useRealTimers();
  });

  it("generates the ECR file on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("UAN|NAME|1|1|1|1|1|1|1|0|0", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));

    await waitFor(() => expect(screen.getByText("Generate EPFO ECR file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Download"));

    await waitFor(() => {
      expect(screen.getByText(/ECR file generated for 2026-06\./)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));

    await waitFor(() => expect(screen.getByText("Generate EPFO ECR file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Download"));

    await waitFor(() => {
      // UX-020: errorMessageFromResponse no longer falls back to
      // "API_ERROR: <status>" — that was the same raw-status-leak bug class
      // UX-003/UX-016 close elsewhere, just via this shared helper. A 404
      // now maps to the catalogued "couldn't load" message.
      expect(screen.getByText(/We couldn't find this information\. It may have been removed or the link may be wrong\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b404\b/)).not.toBeInTheDocument();
  });
});
