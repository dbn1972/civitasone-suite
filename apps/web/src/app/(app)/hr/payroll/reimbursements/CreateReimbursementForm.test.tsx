import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateReimbursementForm } from "./CreateReimbursementForm";

// UX-017: CreateReimbursementForm now reads its copy through next-intl
// (useTranslations("createReimbursementForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateReimbursementForm />
    </NextIntlClientProvider>,
  );
}

describe("CreateReimbursementForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  it("creates a reimbursement claim on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "r1", category: "medical", amount_minor: 250000, status: "submitted" } }),
        { status: 201 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));

    await waitFor(() => expect(screen.getByText("Submit this reimbursement claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit claim"));

    await waitFor(() => {
      expect(screen.getByText(/Reimbursement claim of .* submitted\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));

    await waitFor(() => expect(screen.getByText("Submit this reimbursement claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit claim"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 400/)).not.toBeInTheDocument();
  });
});
