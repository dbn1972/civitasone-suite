import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const EMP_ID = "11111111-1111-4111-8111-111111111111";
type SearchOpts = { onForbidden?: () => void };
const searchEmployeesMock = vi.fn(async (_q: string, _s?: AbortSignal, _o?: SearchOpts) => [{ id: EMP_ID, label: "Meera Iyer (EMP-0451)" }]);
vi.mock("@/lib/entityAdapters/payrollEmployee", () => ({
  searchPayrollEmployees: (q: string, s: AbortSignal, o?: SearchOpts) => searchEmployeesMock(q, s, o),
  resolvePayrollEmployees: async () => [],
}));

import { ComputeFnfForm } from "./ComputeFnfForm";

const HR_SNAPSHOT = {
  basicMonthlyMinor: 5000000,
  breakdown: {
    leaveEncashment: { leaveBalanceDays: 120, amountMinor: 20000000 },
    gratuity: { completedYears: 25, amountMinor: 72115385 },
  },
};

// GAP-PAYROLL-FNF-03: GET /v1/payroll/fnf/pay-snapshot (derived from finalised payslips).
const PAY_SNAPSHOT = {
  available: true, fyStartYear: 2026, wageMonths: 4, ytdMonths: 4,
  lastDrawnWagesMinor: "6000000", avgSalaryLast10MonthsMinor: "5950050", salaryYtdMinor: "28000000", tdsYtdMinor: "150000",
};
let hrAvailable = true;
let computeStatus = 202;
let computeBody: unknown = null;
let paySnapshot: unknown = { available: false, fyStartYear: 2026, wageMonths: 0, ytdMonths: 0, lastDrawnWagesMinor: "0", avgSalaryLast10MonthsMinor: "0", salaryYtdMinor: "0", tdsYtdMinor: "0" };
const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.includes("fnf/pay-snapshot")) {
    return new Response(JSON.stringify({ data: paySnapshot }), { status: 200 });
  }
  if (url.includes("fnf-calculate")) {
    return hrAvailable ? new Response(JSON.stringify(HR_SNAPSHOT), { status: 200 }) : new Response(null, { status: 503 });
  }
  if (url.includes("fnf/compute")) {
    if (computeBody) return new Response(JSON.stringify(computeBody), { status: computeStatus });
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
    computeBody = null;
    paySnapshot = { available: false, fyStartYear: 2026, wageMonths: 0, ytdMonths: 0, lastDrawnWagesMinor: "0", avgSalaryLast10MonthsMinor: "0", salaryYtdMinor: "0", tdsYtdMinor: "0" };
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

    fireEvent.change(screen.getByLabelText(/Reason for overriding/), { target: { value: "Service book shows 2 extra years of deputation" } });
    fireEvent.click(screen.getByText("Compute Settlement"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Completed Years: records say 25, entered 27");
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

  it("GAP-PAYROLL-FNF-04: after a queued compute the list is re-fetched every 5 s (bounded), and Refresh re-fetches on demand", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderForm();
      await pickEmployeeAndDate();
      await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
      fillMoney();
      fireEvent.click(screen.getByText("Compute Settlement"));
      await screen.findByRole("alertdialog");
      fireEvent.click(screen.getByText("Compute settlement"));
      await waitFor(() => expect(screen.getByText("fnf compute queued")).toBeInTheDocument());
      const afterCompute = refreshMock.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      expect(refreshMock.mock.calls.length).toBe(afterCompute + 1);
      for (let i = 0; i < 20; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      // bounded: 12 poll ticks in total, never indefinite
      expect(refreshMock.mock.calls.length).toBe(afterCompute + 12);
      fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
      expect(refreshMock.mock.calls.length).toBe(afterCompute + 13);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── GAP-PAYROLL-FNF-03: pay-record derivation (server holds the caller to it) ──
  it("GAP-PAYROLL-FNF-03: wages / average / YTD salary / YTD TDS are filled from the payslips, locked, and sent without overrides", async () => {
    paySnapshot = PAY_SNAPSHOT;
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Last Drawn Wages/)).toHaveValue("60000.00"));
    expect(screen.getByLabelText(/Avg Salary — Last 10 Months/)).toHaveValue("59500.50");
    expect(screen.getByLabelText(/Salary YTD/)).toHaveValue("280000.00");
    expect(screen.getByLabelText(/TDS YTD/)).toHaveValue("1500.00");
    for (const re of [/Last Drawn Wages/, /Avg Salary — Last 10 Months/, /Salary YTD/, /TDS YTD/]) {
      expect(screen.getByLabelText(re)).toHaveAttribute("readonly");
    }
    expect(screen.getByText(/filled in from 4 finalised payslip/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    const body = JSON.parse(String(computeCalls()[0]![1]!.body));
    expect(body).toMatchObject({ lastDrawnWagesMinor: "6000000", avgSalaryLast10MonthsMinor: "5950050", salaryYtdMinor: "28000000", tdsYtdMinor: "150000", fyStartYear: 2026 });
    expect(body).not.toHaveProperty("overrides");
  });

  it("GAP-PAYROLL-FNF-03: overriding a payslip-derived figure needs a reason and is sent as an override of exactly that field", async () => {
    paySnapshot = PAY_SNAPSHOT;
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Salary YTD/)).toHaveValue("280000.00"));
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.click(screen.getByLabelText("Override payslip figure (₹2,80,000.00)"));
    fireEvent.change(screen.getByLabelText(/Salary YTD/), { target: { value: "300000" } });
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByText(/Give a reason of at least 10 characters/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason for overriding/), { target: { value: "Arrears of 20,000 paid outside payroll" } });
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    const body = JSON.parse(String(computeCalls()[0]![1]!.body));
    expect(body.salaryYtdMinor).toBe("30000000");
    expect(body.overrides).toEqual({ fields: ["salaryYtd"], reason: "Arrears of 20,000 paid outside payroll" });
  });

  it("GAP-PAYROLL-FNF-03: ticking Override but leaving the payslip value unchanged is not an override", async () => {
    paySnapshot = PAY_SNAPSHOT;
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/TDS YTD/)).toHaveValue("1500.00"));
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.click(screen.getByLabelText("Override payslip figure (₹1,500.00)"));
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    expect(JSON.parse(String(computeCalls()[0]![1]!.body))).not.toHaveProperty("overrides");
  });

  it("GAP-PAYROLL-FNF-03: the server's 422 FNF_OVERRIDE_REQUIRED is explained, not shown as a generic failure", async () => {
    computeStatus = 422;
    computeBody = { code: "FNF_OVERRIDE_REQUIRED", message: "these inputs differ from the employee's payslips (salaryYtd)" };
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(screen.getByText(/These figures differ from the employee's payslips/)).toBeInTheDocument());
  });

  // ── GAP-PAYROLL-FNF-05: death settlement payee ──
  const fillNominee = (over: Record<string, string> = {}) => {
    const v = { name: "Sunita Devi", rel: "spouse", acct: "50100123456789", ifsc: "hdfc0001234", doc: "LHC/2026/0042", ...over };
    fireEvent.change(screen.getByLabelText(/Payee name/), { target: { value: v.name } });
    fireEvent.change(screen.getByLabelText(/Relationship to the employee/), { target: { value: v.rel } });
    fireEvent.change(screen.getByLabelText(/Payee bank account number/), { target: { value: v.acct } });
    fireEvent.change(screen.getByLabelText(/Payee bank IFSC/), { target: { value: v.ifsc } });
    fireEvent.change(screen.getByLabelText(/Legal-heir \/ succession certificate reference/), { target: { value: v.doc } });
  };

  it("GAP-PAYROLL-FNF-05: nominee fields appear only for a death separation", () => {
    renderForm();
    expect(screen.queryByLabelText(/Payee name/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Separation Type/), { target: { value: "death" } });
    expect(screen.getByLabelText(/Payee name/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Separation Type/), { target: { value: "resignation" } });
    expect(screen.queryByLabelText(/Payee name/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FNF-05: a death settlement is blocked until the nominee is complete and valid", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.change(screen.getByLabelText(/Separation Type/), { target: { value: "death" } });
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByText(/Enter the payee's name, relationship/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fillNominee({ acct: "12345", ifsc: "BAD" });
    fireEvent.click(screen.getByText("Compute Settlement"));
    expect(screen.getByLabelText(/Payee bank account number/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(computeCalls()).toHaveLength(0);
  });

  it("GAP-PAYROLL-FNF-05: a complete nominee is sent (IFSC upper-cased), and the confirm dialog shows only the account's last 4", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fireEvent.change(screen.getByLabelText(/Separation Type/), { target: { value: "death" } });
    fillMoney();
    fillNominee();
    fireEvent.click(screen.getByText("Compute Settlement"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Payee: Sunita Devi (Spouse), account ending 6789.");
    expect(dialog.textContent).not.toContain("50100123456789");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    const body = JSON.parse(String(computeCalls()[0]![1]!.body));
    expect(body.separationType).toBe("death");
    expect(body.nominee).toEqual({ name: "Sunita Devi", relationship: "spouse", accountNumber: "50100123456789", ifsc: "HDFC0001234", documentRef: "LHC/2026/0042" });
  });

  it("GAP-PAYROLL-FNF-05: a non-death settlement never sends a nominee", async () => {
    renderForm();
    await pickEmployeeAndDate();
    await waitFor(() => expect(screen.getByLabelText(/Completed Years/)).toHaveValue(25));
    fillMoney();
    fireEvent.click(screen.getByText("Compute Settlement"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute settlement"));
    await waitFor(() => expect(computeCalls()).toHaveLength(1));
    expect(JSON.parse(String(computeCalls()[0]![1]!.body))).not.toHaveProperty("nominee");
  });
});
