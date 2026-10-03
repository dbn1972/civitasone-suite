import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({
  getFinanceAdvances: vi.fn(),
  getFinanceBills: vi.fn(),
  getFinanceGuarantees: vi.fn(),
  getFinanceSchemes: vi.fn(),
  getFinanceUCs: vi.fn(),
}));
vi.mock("@/app/_data/loaders", () => loaders);
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./advances/AdvancesTable", () => ({ AdvancesTable: () => <div>advances-table</div> }));
vi.mock("./bills/BillsTable", () => ({ BillsTable: () => <div>bills-table</div> }));
vi.mock("./guarantees/GuaranteesTable", () => ({ GuaranteesTable: () => <div>guarantees-table</div> }));
vi.mock("./scheme-tracking/SchemeTable", () => ({ SchemeTable: () => <div>scheme-table</div> }));
vi.mock("./utilization-certificates/UCsTable", () => ({ UCsTable: () => <div>ucs-table</div> }));
vi.mock("../_components/PrintExportButton", () => ({ PrintExportButton: () => <button>export</button> }));

import AdvancesPage from "./advances/page";
import BillsPage from "./bills/page";
import GuaranteesPage from "./guarantees/page";
import SchemeTrackingPage from "./scheme-tracking/page";
import UCsPage from "./utilization-certificates/page";

const failure = { data: [], source: "error" as const, status: 500 };

describe("expenditure list pages on a FAILED load (FAILMASK)", () => {
  beforeEach(() => Object.values(loaders).forEach((m) => m.mockReset()));

  const cases: [string, keyof typeof loaders, () => Promise<React.ReactElement>, number][] = [
    ["advances", "getFinanceAdvances", () => AdvancesPage(), 4],
    ["bills", "getFinanceBills", () => BillsPage(), 4],
    ["guarantees", "getFinanceGuarantees", () => GuaranteesPage(), 5],
    ["scheme tracking", "getFinanceSchemes", () => SchemeTrackingPage(), 4],
    ["utilization certificates", "getFinanceUCs", () => UCsPage({}), 6],
  ];

  for (const [name, loader, page, dashes] of cases) {
    it(`${name}: every stat reads "—" (never 0 / ₹0.00) and a retryable error state replaces the table`, async () => {
      loaders[loader].mockResolvedValue(failure);
      render(await page());
      expect(screen.getAllByText("—")).toHaveLength(dashes);
      expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(screen.queryByText(/-table$/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    });
  }

  it("a genuinely empty tenant (api ok, []) still shows real zeros and the table", async () => {
    loaders.getFinanceAdvances.mockResolvedValue({ data: [], source: "api" });
    render(await AdvancesPage());
    expect(screen.getByText("advances-table")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("403 on a failed load renders permission-denied, not a retry loop", async () => {
    loaders.getFinanceBills.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "not allowed" });
    render(await BillsPage());
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });
});

describe("expenditure stat cards mean what they say", () => {
  beforeEach(() => Object.values(loaders).forEach((m) => m.mockReset()));

  it("bills: pipeline excludes paid bills; Paid card is labelled all-time", async () => {
    loaders.getFinanceBills.mockResolvedValue({
      data: [
        { id: "1", status: "pending", amount: "10000" },
        { id: "2", status: "paid", amount: "5000" },
      ],
      source: "api",
    });
    render(await BillsPage());
    expect(screen.getByText("statValueInPipeline").closest(".stat")).toHaveTextContent("₹100.00");
    expect(screen.getByText("statPaidAllTime").closest(".stat")).toHaveTextContent("₹50.00");
    expect(screen.queryByText("statPaidMtd")).not.toBeInTheDocument();
  });

  it("UCs: a rejected UC has its own card and is not in Pending Submission", async () => {
    loaders.getFinanceUCs.mockResolvedValue({
      data: [
        { id: "1", status: "pending", amount: "100" },
        { id: "2", status: "rejected", amount: "100" },
      ],
      source: "api",
    });
    render(await UCsPage({}));
    expect(screen.getByText("statPendingSubmission").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("statRejected").closest(".stat")).toHaveTextContent("1");
  });

  // GAP-FINANCE-EXPENDITURE-GUARANTEES-01: expiry is computed from the validity date, never from status alone.
  it("guarantees: 'expiring soon' and 'lapsed' come from validUntil (IST days), not from status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T06:00:00.000Z"));
    try {
      loaders.getFinanceGuarantees.mockResolvedValue({
        data: [
          { id: "1", status: "active", validUntil: "2026-10-12" },
          { id: "2", status: "active", validUntil: "2027-06-30" },
          { id: "3", status: "active", validUntil: "2026-09-01" },
          { id: "4", status: "cancelled", validUntil: "2026-09-01" },
          { id: "5", status: "active" },
        ],
        source: "api",
      });
      render(await GuaranteesPage());
      expect(screen.getByText("statExpiringSoon").closest(".stat")).toHaveTextContent("1");
      expect(screen.getByText("statLapsed").closest(".stat")).toHaveTextContent("1");
      expect(screen.queryByText("statOtherStatus")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("schemes and guarantees: 4th card is 'other status', not UC / expiry", async () => {
    loaders.getFinanceSchemes.mockResolvedValue({ data: [{ status: "active" }, { status: "on_hold" }], source: "api" });
    render(await SchemeTrackingPage());
    expect(screen.getByText("statOtherStatus").closest(".stat")).toHaveTextContent("1");
    expect(screen.queryByText("statPendingUc")).not.toBeInTheDocument();
  });
});
