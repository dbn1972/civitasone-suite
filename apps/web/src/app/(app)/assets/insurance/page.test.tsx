import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InsurancePoliciesPage from "./page";

const assetsPage = {
  data: [{ id: "a1", code: "AST-001", name: "Server Rack" }],
  source: "api" as const,
};

const policyRow = {
  id: "p1",
  assetId: "a1",
  policyNo: "POL-2026-001",
  insurer: "National Insurance Co",
  coverageMinor: "50000000",
  premiumMinor: "1250000",
  currency: "INR",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  status: "active",
};

describe("InsurancePoliciesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the policies list", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [policyRow], source: "api" });

    const ui = await InsurancePoliciesPage();
    render(ui);

    expect(screen.getByText("POL-2026-001")).toBeInTheDocument();
    expect(screen.getByText("National Insurance Co")).toBeInTheDocument();
  });

  it("renders an empty state when there are no policies", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InsurancePoliciesPage();
    render(ui);

    expect(screen.getByText("No insurance policies")).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-05
  it("shows exactly ONE error region (with Retry) when the policies loader errors, and no zero stats", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 });

    render(await InsurancePoliciesPage());

    expect(screen.queryAllByText("Couldn't load — showing nothing")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /retry|try again/i })).toHaveLength(1);
    expect(screen.queryByText("Total Policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Policies", { selector: "h3" })).not.toBeInTheDocument();
  });

  it("shows access-restricted (not a retry) when the policies loader returns 403", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [], source: "error", status: 403, errorMessage: "insufficient role" });

    render(await InsurancePoliciesPage());

    expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
    expect(screen.getByText(/insufficient role/i)).toBeInTheDocument();
  });

  it("disables the create form with an explanation when only the assets load fails; the table still renders", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 })
      .mockResolvedValueOnce({ data: [policyRow], source: "api" });

    render(await InsurancePoliciesPage());

    expect(screen.getByText("POL-2026-001")).toBeInTheDocument();
    expect(screen.getByText(/Couldn.t load assets, so a policy can.t be created/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create insurance policy" })).toBeDisabled();
  });

  // GAP-ASSETS-INSURANCE-03
  it("never shows a raw asset UUID: an asset outside the loaded list gets a fallback label linking to the asset", async () => {
    const uuid = "9b1d2f4e-0000-4000-8000-00000000abcd";
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({ data: [{ ...policyRow, assetId: uuid }], source: "api" });

    render(await InsurancePoliciesPage());

    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Asset (not in loaded list)" });
    expect(link).toHaveAttribute("href", `/assets/${uuid}`);
  });

  it("reads assetCode (as the other asset loaders do) for the asset label", async () => {
    // mapResponse is what turns the payload into options; run the real one.
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation(async (url: string, _fb: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
      if (url.includes("/assets/assets")) return { data: opts.mapResponse([{ id: "a1", assetCode: "AST-77", name: "Generator" }]), source: "api" };
      return { data: [policyRow], source: "api" };
    });

    render(await InsurancePoliciesPage());

    expect(screen.getByRole("link", { name: "AST-77 · Generator" })).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-04
  it("counts an expired-status policy and an active-but-past-end policy as Lapsed, and one active as Active", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assetsPage)
      .mockResolvedValueOnce({
        data: [
          { ...policyRow, id: "p1", policyNo: "A", endDate: "2099-01-01", status: "active" },
          { ...policyRow, id: "p2", policyNo: "B", endDate: "2020-01-01", status: "active" },
          { ...policyRow, id: "p3", policyNo: "C", endDate: "2099-01-01", status: "expired" },
        ],
        source: "api",
      });

    render(await InsurancePoliciesPage());

    const tile = (label: string) => screen.getAllByText(label)[0]!.closest("div")!.parentElement!.textContent ?? "";
    expect(tile("Total Policies")).toContain("3");
    expect(tile("Active")).toContain("1");
    expect(tile("Lapsed")).toContain("2");
  });
});
