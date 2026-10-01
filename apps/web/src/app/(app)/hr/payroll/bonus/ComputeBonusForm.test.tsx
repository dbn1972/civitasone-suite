import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// GAP-PAYROLL-BONUS-01: the employee is picked through the shared EntityPicker
// + searchEmployees adapter (mocked here), never typed as a UUID.
const EMP = { id: "33333333-3333-4333-8333-333333333301", label: "Ravi Kumar (EMP-0042)" };
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async (q: string) => (EMP.label.toLowerCase().includes(q.toLowerCase()) ? [EMP] : [])),
  resolveEmployees: vi.fn(async () => []),
}));

import { ComputeBonusForm } from "./ComputeBonusForm";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComputeBonusForm />
    </NextIntlClientProvider>,
  );
}

async function pickEmployee() {
  fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Ravi" } });
  fireEvent.mouseDown(await screen.findByText(EMP.label));
}

function accepted() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "b1", status: "accepted", correlationId: "c1" }), { status: 202 }),
  );
}

describe("ComputeBonusForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has no free-text Employee ID input", () => {
    renderForm();
    expect(screen.queryByLabelText(/Employee ID/)).not.toBeInTheDocument();
  });

  it("blocks submit with an inline error until an employee is picked", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Select an employee.");
    expect(screen.queryByText("Compute this bonus?")).not.toBeInTheDocument();
  });

  it.each([["8.32"], ["20.01"], [""], ["abc"]])("rejects bonus %% %s without opening the dialog (GAP-PAYROLL-BONUS-03)", async (pct) => {
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.change(screen.getByLabelText(/^Bonus %/), { target: { value: pct } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Bonus % must be between 8.33 and 20");
    expect(screen.queryByText("Compute this bonus?")).not.toBeInTheDocument();
  });

  it("rejects a basic with more than 2 decimals (no float rounding, GAP-PAYROLL-BONUS-02)", async () => {
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Basic salary must be a positive amount in rupees.");
  });

  it("confirms with the employee's name, posts paise + exact percent, and handles the 202 envelope", async () => {
    const fetchSpy = accepted();
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ravi Kumar (EMP-0042)");
    expect(dialog).not.toHaveTextContent(EMP.id);
    // 21,000 x 8.33% = 1,749.30 (server formula, half-up on paise)
    expect(dialog).toHaveTextContent("₹1,749.30");

    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Bonus computation of ₹1,749.30 submitted."));
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ employeeId: EMP.id, fy: expect.stringMatching(/^\d{4}-\d{2}$/), basicMinor: 2100000, bonusPct: 8.33 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    await screen.findByText("Compute this bonus?");
    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
  });
});
