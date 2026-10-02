import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));

import RevisedEstimatesPage from "./page";

const FY = "2026-27";
const props = { searchParams: { fy: FY } };
const budget = (o: Record<string, unknown>) => ({ id: "b", majorHead: "2210", subHead: "Health", financialYear: FY, beMinor: "10000000", reMinor: "12000000", ...o });
const MOCK_BUDGETS = [budget({ id: "b1" })];

describe("RevisedEstimatesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the BE/RE table and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_BUDGETS, source: "api" });
    render(await RevisedEstimatesPage(props));
    expect(screen.getByText("Total Heads")).toBeInTheDocument();
    expect(screen.getByText("2210")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no budget heads (source: api, [])", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await RevisedEstimatesPage(props));
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByText(`No revised estimates for FY ${FY}.`)).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the BE/RE table — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await RevisedEstimatesPage(props));
    expect(screen.getByText("We couldn't load revised estimates.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  // UX-006: a row with null/missing beMinor must render "—" for BE and Variance %, never ₹0.00.
  it("renders an honest '—' for a row with a missing beMinor, never a fabricated ₹0.00 (UX-006)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [budget({ id: "b1" }), budget({ id: "b2", majorHead: "2211", subHead: "Family Welfare", beMinor: null, reMinor: "5000000" })],
      source: "api",
    });
    render(await RevisedEstimatesPage(props));
    expect(screen.getByText("2211")).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-FINANCE-BUDGET-REVISED-ESTIMATES-01
  it("lists one row per head for the selected FY only, and re-selecting the FY switches rows", async () => {
    const data = [
      budget({ id: "cur", majorHead: "2210", financialYear: "2026-27", beMinor: "10000000", reMinor: "12000000" }),
      budget({ id: "old", majorHead: "2210", financialYear: "2025-26", beMinor: "7000000", reMinor: "7000000" }),
    ];
    fetchJsonMock.mockResolvedValue({ data, source: "api" });
    const { unmount } = render(await RevisedEstimatesPage({ searchParams: { fy: "2026-27" } }));
    expect(screen.getByText("₹1,00,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹70,000.00")).not.toBeInTheDocument();
    expect(screen.getByText(/FY 2026-27/)).toBeInTheDocument();
    unmount();
    render(await RevisedEstimatesPage({ searchParams: { fy: "2025-26" } }));
    expect(screen.getAllByText("₹70,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹1,00,000.00")).not.toBeInTheDocument();
  });

  it("falls back to the current FY for a malformed ?fy=", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await RevisedEstimatesPage({ searchParams: { fy: "2026-99" } }));
    expect(screen.queryByText(/FY 2026-99/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-BUDGET-REVISED-ESTIMATES-02: exact BigInt variance/status above 2^53.
  it("compares BE/RE exactly above 2^53 paise: a 1-paise rise is 'Increased'", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [budget({ beMinor: "900719925474099301", reMinor: "900719925474099302" })], source: "api",
    });
    render(await RevisedEstimatesPage(props));
    expect(screen.getByText("▲ Increased")).toBeInTheDocument();
    expect(screen.getByText("₹9,00,71,99,25,47,40,993.01")).toBeInTheDocument();
    expect(screen.getByText("₹9,00,71,99,25,47,40,993.02")).toBeInTheDocument();
  });

  it("sorts by |variance| with an exact BigInt compare: equal magnitudes put the increase first, no-variance rows last", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        budget({ id: "n", majorHead: "0001", beMinor: null, reMinor: "5" }),
        budget({ id: "dec", majorHead: "0002", beMinor: "10000", reMinor: "9000" }),
        budget({ id: "inc", majorHead: "0003", beMinor: "10000", reMinor: "11000" }),
        budget({ id: "big", majorHead: "0004", beMinor: "900719925474099301", reMinor: "900719925474099302" }),
      ],
      source: "api",
    });
    render(await RevisedEstimatesPage(props));
    const order = screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(order).toEqual(["0003", "0002", "0004", "0001"]);
  });

  // GAP-FINANCE-BUDGET-REVISED-ESTIMATES-04
  it("counts material variances (12% yes, 5% no) and lists the biggest revision first", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        budget({ id: "small", majorHead: "1111", beMinor: "10000", reMinor: "10500" }),
        budget({ id: "big", majorHead: "2222", beMinor: "10000", reMinor: "11200" }),
      ],
      source: "api",
    });
    render(await RevisedEstimatesPage(props));
    expect(screen.getByText("Material variance (≥10%)")).toBeInTheDocument();
    const heads = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(heads.findIndex((t) => t.includes("2222"))).toBeLessThan(heads.findIndex((t) => t.includes("1111")));
  });
});
