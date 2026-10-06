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

const getGrantInstallmentsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantInstallments: () => getGrantInstallmentsMock(),
}));

import GrantInstallmentsPage from "./page";

const ROW = {
  id: "inst-1",
  grantId: "grant-1",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat, Nashik",
  installmentNo: 1,
  amount: 500000,
  scheduledDate: "2026-10-01",
  releasedDate: undefined,
  status: "pending" as const,
};

describe("GrantInstallmentsPage", () => {
  beforeEach(() => {
    getGrantInstallmentsMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantInstallmentsMock.mockResolvedValue({ data: [ROW], source: "api" });
  });

  // GAP-GRANTS-INSTALLMENTS-05: a failed empty load shows a retry state, not zeros.
  it("shows a retry/error state on a failed empty load", async () => {
    getGrantInstallmentsMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrantInstallmentsPage({}));
    expect(screen.getByText(/couldn't load installments/i)).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-05: api + empty shows zeros + table, not an error.
  it("shows zero stats on an empty successful load", async () => {
    getGrantInstallmentsMock.mockResolvedValue({ data: [], source: "api" });
    render(await GrantInstallmentsPage({}));
    expect(screen.queryByText(/couldn't load installments/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-06: Released and Utilised are separate stats.
  it("reports Released and Utilised separately", async () => {
    getGrantInstallmentsMock.mockResolvedValue({
      data: [
        { ...ROW, id: "a", status: "released" as const },
        { ...ROW, id: "b", status: "utilized" as const },
      ],
      source: "api",
    });
    render(await GrantInstallmentsPage({}));
    // Both appear as stat-card labels (className "lab"), distinct from the
    // StatusPill text ("Released"/"Utilised") in the table rows.
    const releasedLabels = screen.getAllByText("Released").filter((el) => el.className.includes("lab"));
    expect(releasedLabels.length).toBe(1);
    const utilisedLabels = screen.getAllByText("Utilised").filter((el) => el.className.includes("lab"));
    expect(utilisedLabels.length).toBe(1);
  });

  // GAP-GRANTS-INSTALLMENTS-04: ?appId filters the list to that grant.
  it("filters the list when ?appId is given", async () => {
    getGrantInstallmentsMock.mockResolvedValue({
      data: [
        { ...ROW, id: "a", grantId: "grant-1", granteeName: "Alpha" },
        { ...ROW, id: "b", grantId: "grant-2", granteeName: "Beta" },
      ],
      source: "api",
    });
    render(await GrantInstallmentsPage({ searchParams: { appId: "grant-1" } }));
    expect(screen.getByText(/Filtered to one grant/i)).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });
});
