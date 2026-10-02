import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InsuranceClaimsPage from "./page";

const policiesPage = {
  data: [
    { id: "p1", policyNo: "POL-2026-001", insurer: "National Insurance Co", assetId: "a1", coverageMinor: "50000000", startDate: "2026-04-01", endDate: "2099-03-31", status: "active" },
  ],
  source: "api" as const,
};

const claimRow = {
  id: "c1",
  policyId: "p1",
  assetId: "a1",
  claimDate: "2026-06-15",
  claimAmountMinor: "800000",
  settledAmountMinor: "0",
  status: "pending",
};

describe("InsuranceClaimsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the claims list", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [claimRow], source: "api" });

    const ui = await InsuranceClaimsPage({});
    render(ui);

    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no claims", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InsuranceClaimsPage({});
    render(ui);

    expect(screen.getByText("No claims filed")).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-05
  it("shows ONE error panel with Retry when the claims loader errors, and no zero stats", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 });

    render(await InsuranceClaimsPage({}));

    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /retry|try again/i })).toHaveLength(1);
    expect(screen.queryByText("Total Claims")).not.toBeInTheDocument();
    expect(screen.queryByText("Claims", { selector: "h3" })).not.toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-04
  it("never shows a raw policy UUID for a claim whose policy is outside the fetched list", async () => {
    const uuid = "7c2f0a11-0000-4000-8000-00000000ffff";
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({ data: [{ ...claimRow, policyId: uuid }], source: "api" });

    render(await InsuranceClaimsPage({}));

    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
    expect(screen.getByText("Policy unavailable")).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-03
  it("counts Settled and Closed separately and links each row to its claim", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(policiesPage)
      .mockResolvedValueOnce({
        data: [
          { ...claimRow, id: "c1", status: "settled" },
          { ...claimRow, id: "c2", status: "closed" },
          { ...claimRow, id: "c3", status: "closed" },
        ],
        source: "api",
      });

    render(await InsuranceClaimsPage({}));

    const tile = (label: string) => screen.getAllByText(label)[0]!.closest("div")!.parentElement!.textContent ?? "";
    expect(tile("Settled")).toContain("1");
    expect(tile("Closed")).toContain("2");
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === "/assets/insurance/claims/c1")).toBe(true);
  });
});
