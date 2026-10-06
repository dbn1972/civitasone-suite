import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const rolesMock = vi.fn(() => ["grant_officer"] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

const getGrantReleasesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantReleases: () => getGrantReleasesMock(),
}));

import GrantReleasesPage from "./page";

const ROW = {
  id: "rel-1",
  releaseNo: "REL-2026-09",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat",
  amount: 15000000, // paise on the wire (₹1,50,000.00) — money is bigint paise end to end
  releaseDate: "2026-10-01",
  bankRef: "SBIN0001234",
  status: "processed" as const,
};

describe("GrantReleasesPage", () => {
  beforeEach(() => {
    getGrantReleasesMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantReleasesMock.mockResolvedValue({ data: [ROW], source: "api" });
  });

  // GAP-GRANTS-RELEASES-05: failed empty load shows retry, not ₹0.00 stats.
  it("shows a retry/error state on a failed empty load", async () => {
    getGrantReleasesMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrantReleasesPage());
    expect(screen.getByText(/couldn't load releases/i)).toBeInTheDocument();
    expect(screen.queryByText("Total Released")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-RELEASES-03 (money unit): Total Released sums MINOR units (paise)
  // and renders with formatMoney. 15000000 paise => ₹1,50,000.00.
  it("renders Total Released from paise", async () => {
    render(await GrantReleasesPage());
    const card = screen.getByText("Total Released").closest(".stat") as HTMLElement;
    expect(card.textContent).toContain("₹1,50,000.00");
  });
});
