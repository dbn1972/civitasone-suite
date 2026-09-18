import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateCorrectionForm } from "./CreateCorrectionForm";

// UX-017: CreateCorrectionForm now reads its copy through next-intl
// (useTranslations("createCorrectionForm")), so every render needs a real
// provider in the tree -- same pattern as
// disbursement/BankFileForm.test.tsx (tranche 9).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateCorrectionForm />
    </NextIntlClientProvider>,
  );
}

describe("CreateCorrectionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  function fillValidForm() {
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Component/), { target: { value: "BASIC" } });
    fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: "2025-04-01" } });
    fireEvent.change(screen.getByLabelText(/^Old Value/), { target: { value: "40000" } });
    fireEvent.change(screen.getByLabelText(/^New Value/), { target: { value: "45000" } });
  }

  it("records a correction on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "c1", employeeId: "e1", component: "BASIC", effectiveFrom: "2025-04-01", affectedPeriods: 3, arrearsMinor: 1500000, status: "pending" },
        }),
        { status: 201 },
      ),
    );

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));

    await waitFor(() => expect(screen.getByText("Record this salary correction?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record correction"));

    await waitFor(() => {
      expect(screen.getByText(/Correction recorded for BASIC/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));

    renderForm();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));

    await waitFor(() => expect(screen.getByText("Record this salary correction?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record correction"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
