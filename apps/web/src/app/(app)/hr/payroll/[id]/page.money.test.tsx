import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown) => ({ data: seed, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["payroll_admin"],
  getSessionUserId: () => null,
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));

import PayrollRunDetailPage from "./page";
import { PayrollRunsTable } from "../PayrollRunsTable";

function renderPage(ui: Awaited<ReturnType<typeof PayrollRunDetailPage>>) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

// GAP-PAYROLL-RUNS-01 acceptance: a run with net 1,23,456.78 renders identically on
// /hr/payroll, /hr/payroll/runs and /hr/payroll/[id] -- the latter two share this adapter
// (lib/payroll/runMoney.ts) and PayrollRunsTable is rendered below against the same run.
const SLIP = {
  id: "slip-1", employeeId: "emp-1", employeeName: "Asha Verma", gross: 1, deductions: 1, net: 1,
  grossMinor: "15000000", deductionsMinor: "2654322", netMinor: "12345678", status: "computed", issues: [],
};

function paiseRun(over: Record<string, unknown> = {}) {
  return {
    id: "run-1", runDate: "2026-09-01", payPeriod: "2026-09", employeeCount: 1,
    // the rupee floats are deliberately WRONG: the exact paise strings must win.
    grossAmount: 1, netAmount: 1, deductions: 1,
    grossMinor: "15000000", netMinor: "12345678", deductionsMinor: "2654322",
    status: "processing", failureReason: null, salarySlips: [SLIP], suspendedEmployees: [],
    ...over,
  };
}

function legacyRun() {
  return {
    id: "run-1", runDate: "2026-09-01", payPeriod: "2026-09", employeeCount: 1,
    grossAmount: 150000, netAmount: 123456.78, deductions: 26543.22,
    status: "processing", failureReason: null,
    salarySlips: [{ ...SLIP, gross: 150000, deductions: 26543.22, net: 123456.78, grossMinor: undefined, deductionsMinor: undefined, netMinor: undefined }],
    suspendedEmployees: [],
  };
}

function mockLoaders(run: Record<string, unknown>, previous: { data: unknown[]; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("month=")) return Promise.resolve(previous);
    return Promise.resolve({ data: run, source: "api" });
  });
}

// The KPI tiles are `.lab` (label) + `.val` (value) siblings; "Deductions" also labels a details row.
function statValue(label: string): string {
  const lab = Array.from(document.querySelectorAll(".lab")).find((e) => e.textContent === label);
  return lab?.nextElementSibling?.textContent ?? "";
}

describe("PayrollRunDetailPage — GAP-PAYROLL-RUNS-01 exact paise", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the run's gross / deductions / net from the paise strings, ignoring the rupee floats", async () => {
    mockLoaders(paiseRun(), { data: [], source: "api" });
    renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    expect(statValue("Gross")).toBe("₹1,50,000.00");
    expect(statValue("Deductions")).toBe("₹26,543.22");
    expect(statValue("Net Pay")).toBe("₹1,23,456.78");
  });

  it("a legacy payload (rupee floats only) renders the identical figures", async () => {
    mockLoaders(legacyRun(), { data: [], source: "api" });
    renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    expect(statValue("Gross")).toBe("₹1,50,000.00");
    expect(statValue("Deductions")).toBe("₹26,543.22");
    expect(statValue("Net Pay")).toBe("₹1,23,456.78");
  });

  it("shows the same net as the runs list for the same run (the /hr/payroll and /hr/payroll/runs table)", async () => {
    mockLoaders(paiseRun(), { data: [], source: "api" });
    const detail = renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    const detailNet = statValue("Net Pay");
    detail.unmount();

    const listRun = { id: "run-1", payPeriod: "2026-09", employeeCount: 1, grossAmount: 1, netAmount: 1, grossMinor: "15000000", netMinor: "12345678", status: "processing" };
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollRunsTable runs={[listRun] as never} source="api" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(detailNet)).toBeInTheDocument();
    expect(detailNet).toBe("₹1,23,456.78");
  });

  it("the month-over-month card compares exact paise against the previous month's grossMinor", async () => {
    mockLoaders(paiseRun(), { data: [{ id: "run-0", payPeriod: "2026-08", employeeCount: 1, grossAmount: 1, netAmount: 1, grossMinor: "10000000", status: "paid" }], source: "api" });
    const { container } = renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    expect(container.textContent).toContain("₹1,00,000.00");
    // (15,000,000 - 10,000,000) / 10,000,000 = +50.0%
    expect(container.textContent).toContain("↑ 50.0%");
  });

  it("a failed previous-month fetch is unknown (no delta), not a fabricated zero", async () => {
    mockLoaders(paiseRun(), { data: [], source: "error" });
    const { container } = renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("↓");
  });

  it("the per-slip money in the table is the slip's paise strings", async () => {
    mockLoaders(paiseRun(), { data: [], source: "api" });
    renderPage(await PayrollRunDetailPage({ params: { id: "run-1" } }));
    // the slips table repeats the run's figures for its one slip
    expect(screen.getAllByText("₹1,23,456.78").length).toBeGreaterThanOrEqual(2);
  });
});
