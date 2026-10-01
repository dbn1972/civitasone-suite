import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["payroll_admin"],
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import PayrollPage from "./page";

// UX-017: CreatePayrollRunForm/PayrollRunsTable (rendered inside this page)
// now read their copy through next-intl (useTranslations), so every render
// needs a real provider in the tree -- same pattern as
// off-cycle/CreateOffCycleForm.test.tsx. This page's own server-side
// getTranslations is separately mocked above (echoes the key) -- the
// provider only needs to cover its CLIENT-side useTranslations children.
function renderPage(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const MOCK_RUNS = [
  { id: "r1", payPeriod: "2026-08", employeeCount: 40, grossAmount: 400000, netAmount: 360000, status: "paid" },
  { id: "r2", payPeriod: "2026-09", employeeCount: 42, grossAmount: 420000, netAmount: 378000, status: "draft" },
];
const MOCK_STRUCTURES = [{ id: "s1", name: "General" }];

function mockFetchJson(runsResult: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/payroll/runs")) return Promise.resolve(runsResult);
    if (path.includes("/payroll/structures")) return Promise.resolve({ data: MOCK_STRUCTURES, source: "api" });
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("PayrollPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders payroll runs and real stat counts on success", async () => {
    mockFetchJson({ data: MOCK_RUNS, source: "api" });
    renderPage(await PayrollPage());
    // "Total Runs" is now t("statTotalRuns") in page.tsx -- this file's
    // getTranslations mock (above) echoes the raw key back, not the
    // English copy, so the rendered label is the key itself.
    expect(screen.getByText("statTotalRuns")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows an honest empty state — not fabricated rows — when a tenant genuinely has zero runs", async () => {
    mockFetchJson({ data: [], source: "api" });
    renderPage(await PayrollPage());
    // Stat cards show real zeros, not a dash — this is a real "nothing yet" state.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state and hides the runs table on a real fetch failure (source: error)", async () => {
    mockFetchJson({ data: [], source: "error" });
    renderPage(await PayrollPage());
    expect(screen.getByText("We couldn't load payroll runs.")).toBeInTheDocument();
    // Stat cards show "—", not a fabricated 0 or a count derived from empty error data.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("does not show the create-payroll-run form as if the tenant just has no structures when the fetch actually failed", async () => {
    mockFetchJson({ data: [], source: "error" });
    renderPage(await PayrollPage());
    expect(screen.queryByText(/No pay structures configured/)).not.toBeInTheDocument();
  });

  // payroll-runs' grossAmount is already whole RUPEES (see PayrollRunsTable's
  // own COMP-019 regression test and #312, the historical fix this mirrors:
  // a real net pay of Rs 90,000 once rendered as Rs 900). GAP-PAYROLL-HOME-03:
  // this stat also used to SUM grossAmount across every paid run ever,
  // double-counting the same employees/money every month -- it now shows
  // only the single most recent actually-paid run. Two distinct "paid"
  // periods are given here specifically to assert BOTH bugs stay fixed: the
  // unit (rupees, not 100x smaller) AND the aggregation (latest run only,
  // not the sum of both -- Rs 8,00,000 would be the old, wrong total).
  it("renders the Total Gross stat as rupees, from the latest paid run only, not 100x smaller or summed across runs (GAP-PAYROLL-HOME-01/03, historically #312)", async () => {
    const PAID_RUN_A = { id: "pr1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 500000, netAmount: 450000, status: "paid" };
    const PAID_RUN_B = { id: "pr2", payPeriod: "2026-08", employeeCount: 12, grossAmount: 300000, netAmount: 270000, status: "paid" };
    mockFetchJson({ data: [PAID_RUN_A, PAID_RUN_B], source: "api" });
    renderPage(await PayrollPage());
    // Latest period (2026-08) is PAID_RUN_B: Rs 3,00,000 -- which, by
    // design, now appears TWICE (the stat card and that same run's own
    // Gross Pay cell in the table below), so this asserts directly rather
    // than via expectRupeeGroundTruthDisplayed (which assumes one match).
    expect(screen.getAllByText("₹3,00,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹3,000.00")).not.toBeInTheDocument(); // the classic 100x-smaller mistake
    expect(screen.queryByText("₹8,00,000.00")).not.toBeInTheDocument(); // the old, wrong sum of both runs
  });
});
