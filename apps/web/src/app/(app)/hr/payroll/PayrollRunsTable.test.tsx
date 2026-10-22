import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { PayrollRunsTable } from "./PayrollRunsTable";
import { expectRupeeGroundTruthDisplayed } from "@/lib/testUtils/money";

// UX-017: PayrollRunsTable now reads its copy through next-intl
// (useTranslations("payrollRunsTable")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderTable(props: React.ComponentProps<typeof PayrollRunsTable>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PayrollRunsTable {...props} />
    </NextIntlClientProvider>,
  );
}

const mockedHook = vi.mocked(useSeededResource);

const sampleRuns = [
  {
    id: "run-1",
    payPeriod: "2026-08",
    employeeCount: 120,
    grossAmount: 4500000,
    netAmount: 4100000,
    // GAP-PAYROLL-HOME-01: the integer-paise strings the table actually renders.
    grossMinor: "450000000",
    netMinor: "410000000",
    status: "paid",
  },
] as never;

describe("PayrollRunsTable — UX-002 (single source of truth for data provenance)", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: sampleRuns,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("shows nothing extra when data is live", () => {
    renderTable({ runs: sampleRuns, source: "api" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // This is the exact contradiction named in the gap report: hr/payroll/page.tsx
  // used to render `<DataSourceBadge source={source} message="Couldn't load
  // payroll runs — showing nothing" />` directly from the server's `source`,
  // while this table separately derived `fromCache` from useSeededResource —
  // so a failed fetch with a usable cache showed BOTH "showing nothing" (from
  // the page) AND "Showing saved data" (from this table) at once. Now both
  // read the same `provenance` value from one hook call, so only one message
  // can ever render for a given fetch outcome.
  it("shows ONE consistent message when the fetch failed but cached payroll runs exist", () => {
    mockedHook.mockReturnValue({
      data: sampleRuns,
      fromCache: true,
      offline: false,
      cachedAt: "2026-09-01T09:30:00.000Z",
      provenance: "cached",
    } as never);
    renderTable({ runs: [], source: "error" });

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Showing saved data/i);
    expect(statusNodes[0]).toHaveTextContent(/could not refresh/i);
    // The contradictory "showing nothing" copy must never appear alongside it.
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });

  it("shows an honest, unambiguous empty state when the fetch failed and no cache exists", () => {
    mockedHook.mockReturnValue({
      data: [],
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "error-no-data",
    } as never);
    renderTable({ runs: [], source: "error" });

    // Two independent role="status" live regions now legitimately coexist here:
    // the page-level DataSourceBadge (data-provenance banner) and EmptyState's
    // own live region (a11y HIGH-3 — a screen reader must hear "no results"
    // too, not just see it). Assert each by its specific text rather than
    // assuming there is exactly one status node.
    expect(screen.getByText(/Couldn't load payroll runs — showing nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    expect(screen.getByText("No payroll runs yet")).toBeInTheDocument();
  });
});

describe("PayrollRunsTable — COMP-019 (rupee/paise unit-convention regression)", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: sampleRuns,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  // The payroll-runs API returns grossAmount/netAmount already converted to
  // whole RUPEES, not paise -- the exact fact #312 ("fix(payroll): correct
  // 100x-too-small gross/net money display") fixed here after a real net pay
  // of Rs 90,000 rendered as Rs 900 on the disbursement-confirmation screen.
  // This file had no regression coverage for that fix at all (its existing
  // tests above cover an unrelated data-provenance concern) -- ground truth
  // below is sampleRuns[0]'s own grossAmount/netAmount, expressed in minor
  // units, matching what the real API would have sent as paise before the
  // rupee conversion.
  it("renders Gross Pay / Net Pay as rupees, not 100x smaller (COMP-019, historically #312)", () => {
    renderTable({ runs: sampleRuns, source: "api" });
    expectRupeeGroundTruthDisplayed(screen, 450000000n); // sampleRuns[0].grossAmount = Rs 45,00,000
    expectRupeeGroundTruthDisplayed(screen, 410000000n); // sampleRuns[0].netAmount = Rs 41,00,000
  });
});

// GAP-PAYROLL-HOME-01 (contract test): the table renders the API's integer-paise
// strings with formatMoney, and never reads the legacy rupee floats.
describe("PayrollRunsTable — GAP-PAYROLL-HOME-01 (integer paise contract)", () => {
  function renderWith(run: Record<string, unknown>) {
    const runs = [{ id: "run-9", payPeriod: "2026-09", employeeCount: 3, status: "paid", ...run }] as never;
    mockedHook.mockReturnValue({ data: runs, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    renderTable({ runs, source: "api" });
  }

  it("grossMinor=9000000 renders ₹90,000.00 (and never the 100x-off ₹900.00)", () => {
    renderWith({ grossMinor: "9000000", netMinor: "8100000" });
    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹81,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹900.00")).not.toBeInTheDocument();
  });

  it("renders from the paise string even when the legacy rupee float disagrees (the float is not read)", () => {
    renderWith({ grossMinor: "9000000", netMinor: "8100000", grossAmount: 1, netAmount: 2 });
    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹1.00")).not.toBeInTheDocument();
  });

  it("never fabricates ₹0.00: a run with neither paise strings nor rupee floats shows an em dash", () => {
    renderWith({});
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps exact paise: ₹1,23,456.78 from 12345678", () => {
    renderWith({ grossMinor: "12345678", netMinor: "12345678" });
    expect(screen.getAllByText("₹1,23,456.78").length).toBeGreaterThanOrEqual(1);
  });
});

// GAP-PAYROLL-RUNS-01: the table renders the API's exact paise strings through
// formatMoney (via lib/payroll/runMoney.ts), preferring them to the rupee floats.
describe("PayrollRunsTable — GAP-PAYROLL-RUNS-01 (exact paise first, legacy rupees as fallback)", () => {
  function withRuns(runs: unknown) {
    mockedHook.mockReturnValue({
      data: runs,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  }

  it("renders grossMinor/netMinor with formatMoney: net 1,23,456.78", () => {
    const runs = [{ id: "run-m", payPeriod: "2026-08", employeeCount: 3, grossAmount: 1, netAmount: 1, grossMinor: "15000000", netMinor: "12345678", status: "paid" }];
    withRuns(runs);
    renderTable({ runs: runs as never, source: "api" });
    expect(screen.getByText("₹1,23,456.78")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000.00")).toBeInTheDocument();
    // the (deliberately wrong) rupee floats on the same row must not be shown
    expect(screen.queryByText("₹1.00")).not.toBeInTheDocument();
  });

  it("a legacy payload (rupee floats only) renders the identical string", () => {
    const runs = [{ id: "run-l", payPeriod: "2026-08", employeeCount: 3, grossAmount: 150000, netAmount: 123456.78, status: "paid" }];
    withRuns(runs);
    renderTable({ runs: runs as never, source: "api" });
    expect(screen.getByText("₹1,23,456.78")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000.00")).toBeInTheDocument();
  });

  it("a run with no usable money fields shows dashes, not ₹0.00", () => {
    const runs = [{ id: "run-x", payPeriod: "2026-08", employeeCount: 3, status: "draft" }];
    withRuns(runs);
    renderTable({ runs: runs as never, source: "api" });
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });
});
