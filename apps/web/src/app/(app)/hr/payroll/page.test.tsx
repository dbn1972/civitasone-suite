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
// Echoes the key; a call with interpolation values (a period label) echoes
// "key|name=value" so a test can assert what was interpolated.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}|${Object.entries(values).map(([k, v]) => `${k}=${String(v)}`).join(",")}` : key,
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
  { id: "r1", payPeriod: "2026-08", employeeCount: 40, grossAmount: 400000, netAmount: 360000, grossMinor: "40000000", netMinor: "36000000", status: "paid" },
  { id: "r2", payPeriod: "2026-09", employeeCount: 42, grossAmount: 420000, netAmount: 378000, grossMinor: "42000000", netMinor: "37800000", status: "draft" },
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

  // payroll-runs money is rendered from the API's integer-paise strings
  // (grossMinor / netMinor; GAP-PAYROLL-HOME-01 -- historically a real net pay
  // of Rs 90,000 once rendered as Rs 900, #312). GAP-PAYROLL-HOME-03:
  // this stat also used to SUM grossAmount across every paid run ever,
  // double-counting the same employees/money every month -- it now shows
  // only the single most recent actually-paid run. Two distinct "paid"
  // periods are given here specifically to assert BOTH bugs stay fixed: the
  // unit (rupees, not 100x smaller) AND the aggregation (latest run only,
  // not the sum of both -- Rs 8,00,000 would be the old, wrong total).
  it("renders the Total Gross stat as rupees, from the latest paid run only, not 100x smaller or summed across runs (GAP-PAYROLL-HOME-01/03, historically #312)", async () => {
    const PAID_RUN_A = { id: "pr1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 500000, netAmount: 450000, grossMinor: "50000000", netMinor: "45000000", status: "paid" };
    const PAID_RUN_B = { id: "pr2", payPeriod: "2026-08", employeeCount: 12, grossAmount: 300000, netAmount: 270000, grossMinor: "30000000", netMinor: "27000000", status: "paid" };
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

  // ── GAP-PAYROLL-HOME-01/03/04 ──────────────────────────────────────────────
  /** The rendered value of the stat tile whose label text is `label`. */
  function tileValue(label: string): string {
    const tile = screen.getByText(label).closest(".stat");
    expect(tile).not.toBeNull();
    return tile!.querySelector(".val")!.textContent ?? "";
  }

  const run = (id: string, payPeriod: string, status: string, employeeCount: number, grossMinor: string) =>
    ({ id, payPeriod, status, employeeCount, grossAmount: Number(grossMinor) / 100, netAmount: 0, grossMinor, netMinor: grossMinor });

  it("HOME-01 contract: a paid run with grossMinor=9000000 shows ₹90,000.00 in the Total Gross tile", async () => {
    mockFetchJson({ data: [run("p1", "2026-08", "paid", 5, "9000000")], source: "api" });
    renderPage(await PayrollPage());
    expect(tileValue("statTotalGrossPeriod|period=August 2026")).toBe("₹90,000.00");
    expect(screen.queryByText("₹900.00")).not.toBeInTheDocument();
  });

  it("HOME-01: the tile reads the paise string, not the legacy rupee float (a disagreeing float is ignored)", async () => {
    mockFetchJson({ data: [{ ...run("p1", "2026-08", "paid", 5, "9000000"), grossAmount: 1 }], source: "api" });
    renderPage(await PayrollPage());
    expect(tileValue("statTotalGrossPeriod|period=August 2026")).toBe("₹90,000.00");
  });

  it("HOME-01: a paid run with neither the paise total nor a rupee float shows a dash, not a fabricated ₹0.00", async () => {
    mockFetchJson({ data: [{ id: "p1", payPeriod: "2026-08", status: "paid", employeeCount: 5 }], source: "api" });
    renderPage(await PayrollPage());
    expect(tileValue("statTotalGrossPeriod|period=August 2026")).toBe("—");
  });

  it("HOME-03: two paid runs of 100 employees show headcount 100 (the latest run), not 200, and name the period", async () => {
    mockFetchJson({
      data: [run("p1", "2026-07", "paid", 100, "50000000"), run("p2", "2026-08", "paid", 100, "50000000")],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaidPeriod|period=August 2026")).toBe("100");
    expect(screen.queryByText("200")).not.toBeInTheDocument();
    // Gross is also the latest run's alone: 5,00,000.00, not the 10,00,000.00 sum.
    expect(tileValue("statTotalGrossPeriod|period=August 2026")).toBe("₹5,00,000.00");
  });

  it("HOME-03: several paid pay-group runs of the latest period are added up (60 + 40 = 100 employees, exact paise gross); earlier periods are not", async () => {
    mockFetchJson({
      data: [
        run("g0", "2026-08", "paid", 100, "50000000"),
        run("g1", "2026-09", "paid", 60, "30000001"),
        run("g2", "2026-09", "paid", 40, "20000002"),
        run("g3", "2026-09", "completed", 7, "999"),
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaidPeriod|period=September 2026")).toBe("100");
    expect(tileValue("statTotalGrossPeriod|period=September 2026")).toBe("₹5,00,000.03");
  });

  it("HOME-03: if one of the period's paid runs has no money figure at all, the gross tile is a dash, not a partial sum", async () => {
    mockFetchJson({
      data: [
        run("g1", "2026-09", "paid", 60, "30000000"),
        { id: "g2", payPeriod: "2026-09", status: "paid", employeeCount: 40 },
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaidPeriod|period=September 2026")).toBe("100");
    expect(tileValue("statTotalGrossPeriod|period=September 2026")).toBe("—");
  });

  // Reviewer finding: GET /v1/payroll/runs is not filtered by run_type, so a paid
  // arrears / supplementary / pensioner run of the same month used to be added to
  // Employees Paid (the same people counted again).
  const typed = (id: string, payPeriod: string, status: string, runType: string, employeeCount: number, grossMinor: string) =>
    ({ ...run(id, payPeriod, status, employeeCount, grossMinor), runType });

  it("HOME-03: a regular run of 100 plus a paid arrears run of 5 in the same period shows 100 employees, and the gross covers both (exact paise)", async () => {
    mockFetchJson({
      data: [
        typed("reg", "2026-09", "paid", "regular", 100, "50000000"),
        typed("arr", "2026-09", "paid", "arrears", 5, "250001"),
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaidPeriod|period=September 2026")).toBe("100");
    expect(screen.queryByText("105")).not.toBeInTheDocument();
    // Total Gross is labelled "all paid runs": 5,00,000.00 + 2,500.01 = 5,02,500.01.
    expect(tileValue("statTotalGrossPeriod|period=September 2026")).toBe("₹5,02,500.01");
  });

  it("HOME-03: supplementary and pensioner runs add no headcount, and several regular pay-group runs still add up", async () => {
    mockFetchJson({
      data: [
        typed("g1", "2026-09", "paid", "regular", 60, "30000000"),
        typed("g2", "2026-09", "paid", "regular", 40, "20000000"),
        typed("sup", "2026-09", "paid", "supplementary", 7, "700000"),
        typed("pen", "2026-09", "paid", "pensioner", 30, "9000000"),
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaidPeriod|period=September 2026")).toBe("100");
    expect(tileValue("statTotalGrossPeriod|period=September 2026")).toBe("₹5,97,000.00"); // 3,00,000 + 2,00,000 + 7,000 + 90,000 in paise, summed in bigint
  });

  it("HOME-03: the tile labels name the month through lib/formatters, never the raw YYYY-MM string", async () => {
    mockFetchJson({ data: [run("p1", "2026-08", "paid", 5, "9000000")], source: "api" });
    renderPage(await PayrollPage());
    expect(screen.getByText("statEmployeesPaidPeriod|period=August 2026")).toBeInTheDocument();
    expect(screen.getByText("statTotalGrossPeriod|period=August 2026")).toBeInTheDocument();
    expect(screen.queryByText(/period=2026-08/)).not.toBeInTheDocument();
  });

  it("HOME-03: before any run is paid the tiles use the plain labels and show real zeros", async () => {
    mockFetchJson({ data: [run("d1", "2026-09", "draft", 7, "1000000")], source: "api" });
    renderPage(await PayrollPage());
    expect(tileValue("statEmployeesPaid")).toBe("0");
    expect(tileValue("statTotalGross")).toBe("₹0.00");
  });

  it("HOME-04: Paid + In Progress + Awaiting Disbursement + Failed always sum to Total Runs", async () => {
    mockFetchJson({
      data: [
        run("1", "2026-04", "paid", 1, "100"),
        run("2", "2026-05", "paid", 1, "100"),
        run("3", "2026-06", "completed", 1, "100"),
        run("4", "2026-07", "draft", 1, "100"),
        run("5", "2026-07", "processing", 1, "100"),
        run("6", "2026-08", "failed", 1, "100"),
        run("7", "2026-08", "failed", 1, "100"),
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    const total = Number(tileValue("statTotalRuns"));
    const parts = ["statPaid", "statInProgress", "statAwaitingDisbursement", "statFailed"].map((k) => Number(tileValue(k)));
    expect(total).toBe(7);
    expect(parts).toEqual([2, 2, 1, 2]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("HOME-04: an approved run (wire 'completed') is counted as awaiting disbursement, never as paid or lumped into failed", async () => {
    mockFetchJson({ data: [run("c1", "2026-09", "completed", 9, "100")], source: "api" });
    renderPage(await PayrollPage());
    expect(tileValue("statAwaitingDisbursement")).toBe("1");
    expect(tileValue("statPaid")).toBe("0");
    expect(tileValue("statFailed")).toBe("0");
    expect(tileValue("statInProgress")).toBe("0");
  });

  it("HOME-04: every tile reads '—' (unknown) on a failed fetch", async () => {
    mockFetchJson({ data: [], source: "error" });
    renderPage(await PayrollPage());
    for (const k of ["statTotalRuns", "statPaid", "statInProgress", "statAwaitingDisbursement", "statFailed", "statEmployeesPaid", "statTotalGross"]) {
      expect(tileValue(k)).toBe("—");
    }
  });
});

// GAP-PAYROLL-RUNS-01: the "Total Gross" tile is the latest PAID run's exact paise total,
// rendered through the same adapter the runs table and the run-detail page use.
describe("PayrollPage — Total Gross tile uses exact paise", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  function totalGrossTile(): string {
    return screen.getByText(/^statTotalGross(Period\|.*)?$/).nextElementSibling?.textContent ?? "";
  }

  it("shows the latest paid run's grossMinor, not a draft run's and not the rupee float", async () => {
    mockFetchJson({
      data: [
        { id: "r1", payPeriod: "2026-08", employeeCount: 40, grossAmount: 1, netAmount: 1, grossMinor: "12345678", netMinor: "11000000", status: "paid" },
        { id: "r2", payPeriod: "2026-09", employeeCount: 42, grossAmount: 2, netAmount: 2, grossMinor: "99999999", netMinor: "90000000", status: "draft" },
      ],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(totalGrossTile()).toBe("₹1,23,456.78");
  });

  it("a legacy payload (rupee float only) renders the same string", async () => {
    mockFetchJson({
      data: [{ id: "r1", payPeriod: "2026-08", employeeCount: 40, grossAmount: 123456.78, netAmount: 110000, status: "paid" }],
      source: "api",
    });
    renderPage(await PayrollPage());
    expect(totalGrossTile()).toBe("₹1,23,456.78");
  });

  it("no paid run yet is a real zero; a failed fetch is a dash", async () => {
    mockFetchJson({ data: [{ id: "r2", payPeriod: "2026-09", employeeCount: 42, grossAmount: 2, netAmount: 2, status: "draft" }], source: "api" });
    const first = render(<NextIntlClientProvider locale="en" messages={enMessages}>{await PayrollPage()}</NextIntlClientProvider>);
    expect(totalGrossTile()).toBe("₹0.00");
    first.unmount();

    mockFetchJson({ data: [], source: "error" });
    renderPage(await PayrollPage());
    expect(totalGrossTile()).toBe("—");
  });
});
