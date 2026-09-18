import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateOffCycleForm } from "./CreateOffCycleForm";

// UX-017: CreateOffCycleForm now reads its copy through next-intl
// (useTranslations("createOffCycleForm")), so every render needs a real
// provider in the tree -- same pattern as
// disbursement/BankFileForm.test.tsx (tranche 9).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateOffCycleForm />
    </NextIntlClientProvider>,
  );
}

describe("CreateOffCycleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid period before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    expect(screen.getByText("Period must be in YYYY-MM format, e.g. 2025-06.")).toBeInTheDocument();
  });

  it("creates an off-cycle run on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "o1", runType: "bonus", period: "2025-06", totalAmountMinor: 500000, itemCount: 1, status: "draft" } }),
        { status: 201 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));

    await waitFor(() => expect(screen.getByText("Create this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create run"));

    await waitFor(() => {
      expect(screen.getByText(/Off-cycle run created for 2025-06/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));

    await waitFor(() => expect(screen.getByText("Create this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create run"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 422/)).not.toBeInTheDocument();
  });
});
