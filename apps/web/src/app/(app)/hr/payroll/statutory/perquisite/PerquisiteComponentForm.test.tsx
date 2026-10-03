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

  // GAP-PAYROLL-STATUTORY-PERQUISITE-05: employeeId/FY are no longer a
  // second, independently-typable copy of the lookup form's own fields --
  // this form now only ever acts on whatever has already been looked up,
  // and shows a prompt instead of a save form until that has happened.
  it("prompts to look up an employee first when no employee/FY is selected yet", () => {
    renderForm({ defaultEmployeeId: "", defaultFy: "" });
    expect(screen.getByText("Look up an employee first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Component" })).not.toBeInTheDocument();
  });

  it("shows the looked-up employee/FY read-only once both are selected", () => {
    renderForm({ defaultEmployeeId: "e1", defaultFy: "2026-27" });
    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("2026-27")).toBeInTheDocument();
    expect(screen.queryByText("Look up an employee first")).not.toBeInTheDocument();
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

    // GAP-PAYROLL-STATUTORY-PERQUISITE-07: the saved message now shows the
    // sentence-cased, translated nature label ("Accommodation"), not the
    // raw backend key ("accommodation").
    await waitFor(() => {
      expect(screen.getByText(/Perquisite component "Accommodation" saved for e1\./)).toBeInTheDocument();
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

  it("flags the value field as aria-invalid on a bad amount, without touching the (now read-only) employee/FY display", () => {
    renderForm({ defaultEmployeeId: "e1", defaultFy: "2026-27" });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));
    expect(screen.getByLabelText(/Value by Employer/)).toHaveAttribute("aria-invalid", "true");
  });

  it("posts valueByEmployer/amountRecovered as plain rupee floats under their original (non-Minor) field names (GAP-PAYROLL-STATUTORY-PERQUISITE-03: verified against payroll-service's own consumer, not a unit bug)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "ok" }), { status: 201 }),
    );

    renderForm({ defaultEmployeeId: "e1", defaultFy: "2026-27" });
    fireEvent.change(screen.getByLabelText(/Value by Employer/), { target: { value: "1500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));
    await waitFor(() => expect(screen.getByText("Save this perquisite component?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valueByEmployer).toBe(1500.5);
    expect(body).not.toHaveProperty("valueByEmployerMinor");
  });
});

// GAP-PAYROLL-STATUTORY-PERQUISITE-06: correcting an existing component.
describe("PerquisiteComponentForm editing an existing component", () => {
  function renderEditing() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PerquisiteComponentForm
          defaultEmployeeId="emp-1"
          defaultFy="2026-27"
          editing={{ nature: "car", description: "Pool car", valueByEmployerMinor: "123456", amountRecoveredMinor: "0" }}
        />
      </NextIntlClientProvider>,
    );
  }

  it("prefills nature/description/amounts from the line, locks the nature, and offers Update + Cancel", () => {
    renderEditing();
    expect((screen.getByLabelText(/^Nature/) as HTMLSelectElement).value).toBe("car");
    expect(screen.getByLabelText(/^Nature/)).toBeDisabled();
    expect((screen.getByLabelText(/^Description/) as HTMLInputElement).value).toBe("Pool car");
    expect((screen.getByLabelText(/Value by Employer/i) as HTMLInputElement).value).toBe("1234.56");
    expect(screen.getByRole("button", { name: "Update component" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toBeInTheDocument();
  });

  it("saving posts the SAME nature (an upsert), so the line is corrected rather than duplicated", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    renderEditing();
    fireEvent.change(screen.getByLabelText(/Value by Employer/i), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Update component" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toMatchObject({ employeeId: "emp-1", fy: "2026-27", nature: "car", valueByEmployer: 2000 });
  });
});
