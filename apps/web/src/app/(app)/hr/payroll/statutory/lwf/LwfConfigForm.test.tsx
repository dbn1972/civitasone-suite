import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LwfConfigForm } from "./LwfConfigForm";

// UX-017: LwfConfigForm now reads its copy through next-intl
// (useTranslations("lwfConfigForm")), so every render needs a real provider
// in the tree -- same pattern as corrections/CreateCorrectionForm.test.tsx
// (tranche 11).
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LwfConfigForm />
    </NextIntlClientProvider>,
  );
}

describe("LwfConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a state code before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));
    expect(screen.getByText("State code is required.")).toBeInTheDocument();
  });

  it("saves an LWF configuration on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { stateCode: "KA", saved: true } }), { status: 201 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/LWF configuration saved for KA\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("warns before overwriting an already-configured state (GAP-PAYROLL-STATUTORY-LWF-05)", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LwfConfigForm existingConfigs={[{ state_code: "KA" }]} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "ka" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.getByText(/KA already has an LWF configuration/)).toBeInTheDocument();
  });

  it("does not warn for a state that is not configured yet (GAP-PAYROLL-STATUTORY-LWF-05)", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LwfConfigForm existingConfigs={[{ state_code: "KA" }]} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "MH" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.queryByText(/already has an LWF configuration/)).not.toBeInTheDocument();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-02: sends the chosen frequency and omits blank amounts (server keeps them)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "MH", status: "accepted", correlationId: "c" }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "mh" } });
    fireEvent.change(screen.getByLabelText("Employee Contribution (₹)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "yearly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    expect(screen.getByText(/employer unchanged, frequency Yearly/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ stateCode: "MH", lwfEmployee: 2500, lwfFrequency: "yearly" });
    expect("lwfEmployer" in body).toBe(false);
  });
});
