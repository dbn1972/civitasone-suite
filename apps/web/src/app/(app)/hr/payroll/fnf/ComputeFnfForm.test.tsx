import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const EMP_ID = "11111111-1111-4111-8111-111111111111";
type SearchOpts = { onForbidden?: () => void };
const searchEmployeesMock = vi.fn(async (_q: string, _s?: AbortSignal, _o?: SearchOpts) => [{ id: EMP_ID, label: "Meera Iyer (EMP-0451)" }]);
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: (q: string, s: AbortSignal, o?: SearchOpts) => searchEmployeesMock(q, s, o),
  resolveEmployees: async () => [],
}));

import { ComputeFnfForm } from "./ComputeFnfForm";

const HR_SNAPSHOT = {
  basicMonthlyMinor: 5000000,
  breakdown: {
    leaveEncashment: { leaveBalanceDays: 120, amountMinor: 20000000 },
    gratuity: { completedYears: 25, amountMinor: 72115385 },
  },
};

let hrAvailable = true;
let computeStatus = 202;
const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.includes("fnf-calculate")) {
    return hrAvailable ? new Response(JSON.stringify(HR_SNAPSHOT), { status: 200 }) : new Response(null, { status: 503 });
  }
  if (url.includes("fnf/compute")) {
    return computeStatus === 202
      ? new Response(JSON.stringify({ data: { message: "fnf compute queued", employeeId: EMP_ID } }), { status: 202 })
      : new Response(null, { status: computeStatus });
  }
  return new Response("[]", { status: 200 });
});

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComputeFnfForm />
    </NextIntlClientProvider>,
  );
}

async function pickEmployeeAndDate() {
  fireEvent.change(screen.getByLabelText(/^Employee \*$/), { target: { value: "Meer" } });
  fireEvent.mouseDown(await screen.findByText("Meera Iyer (EMP-0451)"));
  fireEvent.change(screen.getByLabelText(/Separation Date/), { target: { value: "2026-07-31" } });
}

function fillMoney(overrides: Record<string, string> = {}) {
  const v = { wages: "50000", avg: "50000.50", ytd: "300000", tds: "0", ...overrides };
  fireEvent.change(screen.getByLabelText(/Last Drawn Wages/), { target: { value: v.wages } });
  fireEvent.change(screen.getByLabelText(/Avg Salary — Last 10 Months/), { target: { value: v.avg } });
  fireEvent.change(screen.getByLabelText(/Salary YTD/), { target: { value: v.ytd } });
  fireEvent.change(screen.getByLabelText(/TDS YTD/), { target: { value: v.tds } });
}

function computeCalls() {
  return fetchSpy.mock.calls.filter(([u]) => String(u).includes("fnf/compute"));
}

describe("ComputeFnfForm", () => {
  beforeEach(() => {
    hrAvailable = true;
    computeStatus = 202;
    fetchSpy.mockClear();
    refreshMock.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchSpy as unknown as typeof fetch);
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByText(/are all required/)).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-05: a 403 from the directory search shows an explicit role message, not a silent empty list", async () => {
    searchEmployeesMock.mockImplementationOnce(async (_q, _s, o) => { o?.onForbidden?.(); return []; });
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Employee \*$/), { target: { value: "Meer" } });
    expect(await screen.findByText(/Your role can't search the employee directory/)).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-05: no raw UUID input; the employee is picked by name", () => {
    renderForm();
    expect(screen.queryByLabelText(/UUID/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-03: picking an employee + date pre-fills completed years and leave balance from HR records, read-only", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    expect(screen.getByLabelText(/Leave Balance/)).toHaveValue(120);
    expect(screen.getByLabelText(/Completed Years/)).toHaveAttribute("readonly");
    expect(screen.getByText("HR estimate (basic pay only): ₹50,000.00")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-03/05: happy path posts paise strings (no float math), names the employee in the confirm dialog, no overrides", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Meera Iyer (EMP-0451)");
    expect(dialog.textContent).not.toContain(EMP_ID);
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(screen.getByText("fnf compute queued")).toBeInTheDocument());
    const body = JSON.parse(String(computeCalls()[0]![1]!.body));
    expect(body).toMatchObject({
      employeeId: EMP_ID, completedYears: 25, leaveBalanceDays: 120,
      lastDrawnWagesMinor: "5000000", avgSalaryLast10MonthsMinor: "5000050", tdsYtdMinor: "0", gratuityGrossMinor: "0",
    });
    expect(body).not.toHaveProperty("overrides");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("GAP-PAYROLL-FNF-03: overriding an HR-derived value requires a reason, which is sent with the compute", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.click(screen.getByLabelText("Override HR record (25)"));
    fireEvent.change(screen.getByLabelText(/Completed Years/), { target: { value: "27" } });
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 10 characters/);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Reason for overriding HR records/), { target: { value: "Service book shows 2 extra years of deputation" } });
    fireEvent.click(screen.getByText("Compute Settlement"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Completed Years: HR record 25, entered 27");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    const body = JSON.parse(String(computeCalls()[0]![1]!.body));
    expect(body.completedYears).toBe(27);
    expect(body.overrides).toEqual({ fields: ["completedYears"], reason: "Service book shows 2 extra years of deputation" });
  });

  it("GAP-PAYROLL-FNF-03: an amount with more than 2 decimals blocks submit instead of being rounded", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fillMoney({ wages: "1.005" });
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 2 decimal places/);
    expect(screen.getByLabelText(/Last Drawn Wages/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(computeCalls()).toHaveLength(0);
  });

  it("GAP-PAYROLL-FNF-03: if HR records can't be loaded, the fields stay editable and the user is told", async () => {
    hrAvailable = false;
    renderForm();
    await pickEmployeeAndDate();
    expect(await screen.findByText(/Couldn't load HR records/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Completed Years/)).not.toHaveAttribute("readonly");
  });

  it("surfaces a clerk-safe message on the confirm dialog, never the raw API error code (UX-016)", async () => {
    computeStatus = 500;
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
