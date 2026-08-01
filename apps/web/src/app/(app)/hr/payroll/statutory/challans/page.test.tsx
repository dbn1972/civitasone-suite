import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ChallansPage from "./page";

describe("ChallansPage", () => {
  beforeEach(() => {
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
    render(ui);
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
    render(ui);
    expect(screen.getByText("No challans ingested for this period")).toBeInTheDocument();
  });
});
