import { describe, it, expect, vi, beforeEach } from "vitest";

// Role gate (see the page's own GAP comment): default every test to an
// authorized payroll role; the gate tests below override per call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EsiStatutoryPage from "./page";

// The page renders client components (period picker), so every render
// gets a real NextIntlClientProvider.
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type Summary = { periods: string[]; period: string | null; recordCount: number; empContribMinor: string; erContribMinor: string; totalContribMinor: string };

// GAP-PAYROLL-STATUTORY-ESI-03: the page now loads GET .../esi/summary (tiles +
// picker) and then GET .../esi?period=...&limit=500 (table).
function mockLedger(summary: Summary | null, rows: Record<string, unknown>[] = [], source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((path: string) => {
    if (source === "error") return Promise.resolve({ data: path.includes("/summary") ? null : [], source: "error" });
    if (path.includes("/summary")) return Promise.resolve({ data: summary, source: "api" });
    return Promise.resolve({ data: rows, source: "api" });
  });
}

const UUID = "3f2a9c1e-7b44-4d2a-9e1f-0a1b2c3d4e5f";
const row = (over: Record<string, unknown> = {}) => ({
  id: "1", employeeId: UUID, period: "2026-08", grossMinor: 5000000, empContribMinor: 600000, erContribMinor: 600000, ...over,
});
const summary = (over: Partial<Summary> = {}): Summary => ({
  periods: ["2026-08", "2026-07"], period: "2026-08", recordCount: 1,
  empContribMinor: "600000", erContribMinor: "600000", totalContribMinor: "1200000", ...over,
});

describe("EsiStatutoryPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders the ledger for the summarised period, with the employee name", async () => {
    mockLedger(summary(), [row({ employeeName: "Asha Rao" })]);
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Total ESI contribution — 2026-08")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-ESI-02: without a name, shows an 8-character code, never the full UUID", async () => {
    mockLedger(summary(), [row()]);
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText("3F2A9C1E")).toBeInTheDocument();
    expect(screen.queryByText(UUID)).not.toBeInTheDocument();
  });

  it("renders an empty state when the ledger has no periods (and skips the row fetch)", async () => {
    mockLedger(summary({ periods: [], period: null, recordCount: 0, empContribMinor: "0", erContribMinor: "0", totalContribMinor: "0" }));
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText("No ESI records")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it("shows the saved-information badge when the loader errors", async () => {
    mockLedger(null, [], "error");
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-ESI-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-ESI-03 [HUMAN REVIEW]: tiles use the server's per-period totals, not a sum of the rows received", async () => {
    // 60 rows in the period; the table only received one of them.
    mockLedger(summary({ recordCount: 60, empContribMinor: "36000000", erContribMinor: "36000000", totalContribMinor: "72000000" }), [row()]);
    renderPage(await EsiStatutoryPage({}));
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText(/7,20,000/)).toBeInTheDocument();
    const paths = fetchJsonMock.mock.calls.map((c) => String(c[0]));
    expect(paths[1]).toBe("/api/v1/payroll/statutory/esi?period=2026-08&limit=500");
    expect(screen.getByText("Showing the first 1 of 60 records for this period. The totals above cover all 60.")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-ESI-03: forwards a valid ?period= to the summary and drops a malformed one", async () => {
    mockLedger(summary({ period: "2026-07" }), [row({ period: "2026-07" })]);
    renderPage(await EsiStatutoryPage({ searchParams: { period: "2026-07" } }));
    expect(String(fetchJsonMock.mock.calls[0][0])).toBe("/api/v1/payroll/statutory/esi/summary?period=2026-07");
    expect(screen.getByText("Total ESI contribution — 2026-07")).toBeInTheDocument();

    fetchJsonMock.mockClear();
    renderPage(await EsiStatutoryPage({ searchParams: { period: "2026-13" } }));
    expect(String(fetchJsonMock.mock.calls[0][0])).toBe("/api/v1/payroll/statutory/esi/summary");
  });

  it("GAP-PAYROLL-STATUTORY-ESI-05: shows the ESI wage ceiling hint from the shared constant", async () => {
    mockLedger(summary(), [row()]);
    renderPage(await EsiStatutoryPage({ searchParams: {} }));
    expect(screen.getByText(/within the ₹21,000\.00 wage ceiling/)).toBeInTheDocument();
  });
});
