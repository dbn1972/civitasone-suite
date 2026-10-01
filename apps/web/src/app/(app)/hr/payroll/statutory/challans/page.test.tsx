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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ChallansPage from "./page";

// UX-017: ChallansPage (Server Component, getTranslations("challans")) also
// renders PeriodSelector and IngestChallanForm, both "use client" components
// that call useTranslations -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ChallansPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders challans for the selected period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/reconcile")) {
        return Promise.resolve({
          data: {
            formType: "24Q", period: "2026-06",
            perPeriod: [{ period: "2026-06", formType: "24Q", tdsDeductedMinor: "100000", tdsDepositedMinor: "100000", varianceMinor: "0", matched: true, challanCount: 1, status: "matched" }],
            totalDeductedMinor: "100000", totalDepositedMinor: "100000", varianceMinor: "0", matched: true, filingBlocked: false, note: "ok",
          },
          source: "api",
        });
      }
      return Promise.resolve({
        data: [{ cin: "C1", bsrCode: "1234567", challanSerial: "1", depositDate: "2026-06-07", section: "192", tdsAmountMinor: "10000", totalAmountMinor: "10000", status: "ingested" }],
        source: "api",
      });
    });

    const ui = await ChallansPage({ searchParams: { period: "2026-06" } });
    renderPage(ui);
    expect(screen.getByText("C1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no challans for the period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/reconcile")) {
        return Promise.resolve({ data: null, source: "api" });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await ChallansPage({ searchParams: { period: "2026-06" } });
    renderPage(ui);
    expect(screen.getByText("No challans ingested for this period")).toBeInTheDocument();
  });

  it("shows a real error state instead of an empty table on a fetch failure", async () => {
    // Regression: the DataTable used to render unconditionally here, not
    // gated on `errored` like every sibling statutory page (esi/gpf/lwf/
    // nps/pf/pt) -- a real outage rendered an empty-looking table instead
    // of the RefreshErrorState contract (retry/back/help).
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await ChallansPage({ searchParams: { period: "2026-06" } });
    renderPage(ui);

    expect(screen.getByText("We couldn't load TDS challans.")).toBeInTheDocument();
    expect(screen.queryByText("No challans ingested for this period")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-CHALLANS-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await ChallansPage({ searchParams: { period: "2026-06" } });
    renderPage(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-CHALLANS-06: shows a translated reconcile status and a formatted deposit date", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/reconcile")) {
        return Promise.resolve({
          data: {
            formType: "24Q", period: "2026-06",
            perPeriod: [{ period: "2026-06", formType: "24Q", tdsDeductedMinor: "100000", tdsDepositedMinor: "0", varianceMinor: "-100000", matched: false, challanCount: 0, status: "no_challan" }],
            totalDeductedMinor: "100000", totalDepositedMinor: "0", varianceMinor: "-100000", matched: false, filingBlocked: true, note: "",
          },
          source: "api",
        });
      }
      return Promise.resolve({
        data: [{ cin: "C9", bsrCode: "1234567", challanSerial: "1", depositDate: "2026-06-07", section: "192", tdsAmountMinor: "10000", totalAmountMinor: "10000", status: "ingested" }],
        source: "api",
      });
    });
    const ui = await ChallansPage({ searchParams: { period: "2026-06" } });
    renderPage(ui);
    expect(screen.getByText("No challan")).toBeInTheDocument();
    expect(screen.queryByText("no_challan")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-06-07")).not.toBeInTheDocument();
  });
});
