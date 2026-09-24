import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ElectFlexBenefitForm } from "./ElectFlexBenefitForm";

// UX-017: ElectFlexBenefitForm now reads its copy through next-intl
// (useTranslations("electFlexBenefitForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ElectFlexBenefitForm />
    </NextIntlClientProvider>,
  );
}

describe("ElectFlexBenefitForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a plan id before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));
    expect(screen.getByText("Plan ID is required.")).toBeInTheDocument();
  });

  it("submits an election on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "el1", planId: "pl1", fy: "2025-26", totalElectedMinor: 500000 } }),
        { status: 201 },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan ID/), { target: { value: "pl1" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Elected Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));

    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));

    await waitFor(() => {
      expect(screen.getByText(/Election submitted:/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Plan ID/), { target: { value: "pl1" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Elected Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));

    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
