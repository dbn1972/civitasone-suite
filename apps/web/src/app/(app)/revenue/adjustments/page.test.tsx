import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AdjustmentsPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerName: "Ravi Kumar",
  identifierNo: "PMC-0001",
  assesseeType: "residential",
};

const DEMANDS = [
  { id: "d1", financialYear: "2025-2026", netMinor: "500000", principalMinor: "500000", rebateMinor: "0", penaltyMinor: "0", interestMinor: "0", status: "raised" },
  { id: "d2", financialYear: "2026-2027", netMinor: "600000", principalMinor: "600000", rebateMinor: "0", penaltyMinor: "0", interestMinor: "0", status: "raised" },
];

describe("AdjustmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await AdjustmentsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders the adjustment form once an assessee with 2+ demands is selected", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/demands")) return Promise.resolve({ data: DEMANDS, source: "api" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await AdjustmentsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getByRole("heading", { name: "Raise Adjustment" })).toBeInTheDocument();
  });

  it("shows the data-source badge instead of fabricating data on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AdjustmentsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("shows a retry error state when the demands fetch fails (ADJUSTMENTS-04)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/demands")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await AdjustmentsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getByText("We couldn't load demands.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a retry error state when the assessees fetch fails (ADJUSTMENTS-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AdjustmentsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("We couldn't load assessees.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders the adjustment register for the selected assessee (ADJUSTMENTS-02)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/adjustments"))
        return Promise.resolve({
          data: [
            { id: "adj-1", createdAt: "2026-07-01T00:00:00.000Z", fromDemandId: "d1", toDemandId: "d2", amountMinor: "25000", reason: "Reallocate" },
          ],
          source: "api",
        });
      if (path.includes("/demands")) return Promise.resolve({ data: DEMANDS, source: "api" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await AdjustmentsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    // Register shows FY labels (not raw demand UUIDs), amount and reason.
    expect(screen.getByText("FY 2025-2026")).toBeInTheDocument();
    expect(screen.getByText("FY 2026-2027")).toBeInTheDocument();
    expect(screen.getByText("Reallocate")).toBeInTheDocument();
    expect(screen.getByText("₹250.00")).toBeInTheDocument();
  });

  it("shows a retry state when the adjustment register fetch fails (ADJUSTMENTS-02/04)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/adjustments")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/demands")) return Promise.resolve({ data: DEMANDS, source: "api" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await AdjustmentsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);
    expect(screen.getByText("We couldn't load the adjustment register.")).toBeInTheDocument();
  });
});
