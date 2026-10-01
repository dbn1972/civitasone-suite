import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
const EMP = { id: "66666666-6666-4666-8666-666666666601", label: "Sunil Das (EMP-0099)" };
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async (q: string) => (EMP.label.toLowerCase().includes(q.toLowerCase()) ? [EMP] : [])),
  resolveEmployees: vi.fn(async () => []),
}));

import { CreateCorrectionForm, isRealIsoDate } from "./CreateCorrectionForm";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateCorrectionForm />
    </NextIntlClientProvider>,
  );
}

async function fillValidForm(overrides: Partial<Record<"old" | "new" | "date", string>> = {}) {
  fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Sunil" } });
  fireEvent.mouseDown(await screen.findByText(EMP.label));
  fireEvent.change(screen.getByLabelText(/^Component/), { target: { value: "BASIC" } });
  fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: overrides.date ?? "2025-04-01" } });
  fireEvent.change(screen.getByLabelText(/^Old Value/), { target: { value: overrides.old ?? "40000" } });
  fireEvent.change(screen.getByLabelText(/^New Value/), { target: { value: overrides.new ?? "45000.50" } });
}

describe("isRealIsoDate (GAP-PAYROLL-CORRECTIONS-04)", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isRealIsoDate("2025-04-01")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2025-13-45")).toBe(false);
    expect(isRealIsoDate("01/04/2025")).toBe(false);
  });
});

describe("CreateCorrectionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-PAYROLL-CORRECTIONS-02: no free-text employee id; an unpicked employee blocks the dialog", () => {
    renderForm();
    expect(screen.queryByLabelText(/Employee ID/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Select an employee.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each([["1e3"], ["12abc"], ["1.005"]])("GAP-PAYROLL-CORRECTIONS-03: old value %s is rejected", async (old) => {
    renderForm();
    await fillValidForm({ old });
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Old value must be a non-negative amount in rupees");
  });

  it("GAP-PAYROLL-CORRECTIONS-04: Effective From is a native date picker", async () => {
    renderForm();
    expect(screen.getByLabelText(/^Effective From/)).toHaveAttribute("type", "date");
  });

  it("names the employee, requires a reason, and posts exact paise + the reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "c1", status: "accepted", correlationId: "x" }), { status: 202 }),
    );
    renderForm();
    await fillValidForm({ old: "0" });
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Sunil Das (EMP-0099)");
    expect(dialog).not.toHaveTextContent(EMP.id);
    const confirm = within(dialog).getByRole("button", { name: "Record correction" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Pay fixation per CPC order" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Correction for BASIC submitted"));
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({
      employeeId: EMP.id, component: "BASIC", effectiveFrom: "2025-04-01",
      oldValueMinor: 0, newValueMinor: 4500050, reason: "Pay fixation per CPC order",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    renderForm();
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Correction" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Pay fixation per CPC order" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record correction" }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
  });
});
