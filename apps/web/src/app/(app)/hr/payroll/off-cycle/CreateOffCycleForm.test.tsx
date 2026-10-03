import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
const EMPS = [
  { id: "88888888-8888-4888-8888-888888888801", label: "Anita Rao (EMP-1)" },
  { id: "88888888-8888-4888-8888-888888888802", label: "Bharat Jain (EMP-2)" },
];
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async (q: string) => EMPS.filter((e) => e.label.toLowerCase().includes(q.toLowerCase()))),
  resolveEmployees: vi.fn(async () => []),
}));

import { CreateOffCycleForm, duplicateEmployeeRows, hasSameTypeAndPeriod } from "./CreateOffCycleForm";

function renderForm(existingRuns: Array<{ run_type: string; period: string }> = []) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateOffCycleForm existingRuns={existingRuns} />
    </NextIntlClientProvider>,
  );
}

async function pick(row: number, label: string) {
  fireEvent.change(screen.getAllByLabelText(/^Employee/)[row]!, { target: { value: label.slice(0, 4) } });
  fireEvent.mouseDown(await screen.findByText(label));
}

describe("duplicateEmployeeRows", () => {
  it("flags only the later occurrences", () => {
    expect([...duplicateEmployeeRows([{ employeeId: "a" }, { employeeId: "b" }, { employeeId: "a" }, { employeeId: null }])]).toEqual([2]);
  });
});

describe("CreateOffCycleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid period before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Period must be in YYYY-MM format");
  });

  it("GAP-PAYROLL-OFF-CYCLE-02: no raw Employee ID input remains", () => {
    renderForm();
    expect(screen.queryByLabelText(/Employee ID/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-OFF-CYCLE-02: selecting the same employee twice shows a duplicate error and blocks the dialog", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    await pick(0, EMPS[0]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[0]!, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Item" }));
    await pick(1, EMPS[0]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[1]!, { target: { value: "200" } });
    expect(screen.getByText("This employee is already in the run.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    expect(screen.queryByText("Create this off-cycle run?")).not.toBeInTheDocument();
  });

  it.each([["1.005"], ["1e3"], ["0"]])("GAP-PAYROLL-OFF-CYCLE-03: amount %s is rejected", async (amount) => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    await pick(0, EMPS[0]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[0]!, { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Every off-cycle item needs an employee and a positive amount");
  });

  it("confirm dialog lists names and amounts; payload is exact paise (202 envelope)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "oc1", status: "accepted", correlationId: "c" }), { status: 202 }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    await pick(0, EMPS[0]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[0]!, { target: { value: "0.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Item" }));
    await pick(1, EMPS[1]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[1]!, { target: { value: "0.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Anita Rao (EMP-1) — ₹0.10")).toBeInTheDocument();
    expect(within(dialog).getByText("Bharat Jain (EMP-2) — ₹0.20")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("₹0.30");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create run" }));

    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Off-cycle run created for Jun 2025 covering 2 employee(s), total ₹0.30."));
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body.items).toEqual([
      { employeeId: EMPS[0]!.id, amountMinor: 10 },
      { employeeId: EMPS[1]!.id, amountMinor: 20 },
    ]);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2025-06" } });
    await pick(0, EMPS[0]!.label);
    fireEvent.change(screen.getAllByLabelText(/^Amount/)[0]!, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Off-Cycle Run" }));
    await waitFor(() => expect(screen.getByText("Create this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create run"));
    await waitFor(() => expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument());
    expect(screen.queryByText(/API_ERROR: 422/)).not.toBeInTheDocument();
  });
});

describe("GAP-PAYROLL-OFF-CYCLE-05: same type + period warning", () => {
  it("hasSameTypeAndPeriod matches on type and period only", () => {
    const runs = [{ run_type: "bonus", period: "2026-08" }];
    expect(hasSameTypeAndPeriod(runs, "bonus", "2026-08")).toBe(true);
    expect(hasSameTypeAndPeriod(runs, "incentive", "2026-08")).toBe(false);
    expect(hasSameTypeAndPeriod(runs, "bonus", "2026-09")).toBe(false);
  });

  it("warns (without blocking) when a run of the same type already exists for the period", () => {
    renderForm([{ run_type: "bonus", period: "2026-08" }]);
    expect(screen.queryByText(/already exists for/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    expect(screen.getByText(/A run of this type already exists for Aug 2026/)).toBeInTheDocument();
    // a different run type for the same period is fine
    fireEvent.change(screen.getByLabelText(/^Run Type/), { target: { value: "incentive" } });
    expect(screen.queryByText(/already exists for/)).not.toBeInTheDocument();
  });
});
