import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PerquisiteComponentForm } from "./PerquisiteComponentForm";

// UX-017: PerquisiteComponentForm now reads its copy through next-intl
// (useTranslations("perquisiteComponentForm")), so every render needs a real
// provider in the tree -- same pattern as pt/PtSlabForm.test.tsx (tranche 12).
function renderForm(props: { defaultEmployeeId: string; defaultFy: string }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PerquisiteComponentForm {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PerquisiteComponentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee ID before opening the confirm dialog", () => {
    renderForm({ defaultEmployeeId: "", defaultFy: "" });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));
    expect(screen.getByText("Employee ID and financial year are required.")).toBeInTheDocument();
  });

  it("saves a perquisite component on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "perquisite component saved" }), { status: 201 }),
    );

    renderForm({ defaultEmployeeId: "e1", defaultFy: "2026-27" });
    fireEvent.change(screen.getByLabelText(/Value by Employer/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));

    await waitFor(() => expect(screen.getByText("Save this perquisite component?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/Perquisite component "accommodation" saved for e1\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm({ defaultEmployeeId: "e1", defaultFy: "2026-27" });
    fireEvent.change(screen.getByLabelText(/Value by Employer/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));

    await waitFor(() => expect(screen.getByText("Save this perquisite component?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 400/)).not.toBeInTheDocument();
  });

  it("flags only the invalid field as aria-invalid, independent of locale text (UX-017 bug-class regression)", () => {
    renderForm({ defaultEmployeeId: "", defaultFy: "" });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));
    expect(screen.getByLabelText(/Employee ID/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Value by Employer/)).not.toHaveAttribute("aria-invalid");
  });
});
