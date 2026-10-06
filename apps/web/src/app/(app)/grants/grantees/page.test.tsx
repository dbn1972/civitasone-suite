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

const getGranteesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantees: () => getGranteesMock(),
}));

import GranteesPage from "./page";

const ROW = {
  id: "ben-1",
  granteeCode: "BEN1",
  name: "District Panchayat, Nashik",
  type: "society" as const,
  registrationNo: undefined,
  activeGrants: 2,
  totalGrantsReceived: 500000,
  ucCompliancePct: 80,
};

describe("GranteesPage", () => {
  beforeEach(() => {
    getGranteesMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGranteesMock.mockResolvedValue({ data: [ROW], source: "api" });
  });

  // GAP-GRANTS-GRANTEES-01: a failed load with no rows shows a retry state,
  // not 0 / 0 / 0 / 0.0% stat cards.
  it("shows a retry/error state (no stat cards) on a failed empty load", async () => {
    getGranteesMock.mockResolvedValue({ data: [], source: "error" });
    render(await GranteesPage());
    expect(screen.getByText(/couldn't load grantees/i)).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText("Avg UC compliance")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-GRANTEES-01: api + empty shows zero stats and the table (not an error).
  it("shows zero stats and the table on an empty but successful load", async () => {
    getGranteesMock.mockResolvedValue({ data: [], source: "api" });
    render(await GranteesPage());
    expect(screen.queryByText(/couldn't load grantees/i)).not.toBeInTheDocument();
    const totalCard = screen.getByText("Total").closest(".stat") as HTMLElement;
    expect(totalCard.textContent).toContain("0");
  });

  // GAP-GRANTS-GRANTEES-02: empty registry / nothing due shows "—", not 0.0%.
  it("shows '—' for Avg UC compliance when no grantee has anything due", async () => {
    getGranteesMock.mockResolvedValue({
      data: [{ ...ROW, activeGrants: 0, ucCompliancePct: 0 }],
      source: "api",
    });
    render(await GranteesPage());
    const card = screen.getByText("Avg UC compliance").closest(".stat") as HTMLElement;
    expect(card.textContent).toContain("—");
    expect(card.textContent).not.toContain("0.0%");
  });

  // GAP-GRANTS-GRANTEES-02: a grantee with nothing due is excluded from the mean.
  it("excludes grantees with no active grants from the compliance mean", async () => {
    getGranteesMock.mockResolvedValue({
      data: [
        { ...ROW, id: "a", activeGrants: 2, ucCompliancePct: 100 },
        { ...ROW, id: "b", activeGrants: 0, ucCompliancePct: 0 },
      ],
      source: "api",
    });
    render(await GranteesPage());
    const card = screen.getByText("Avg UC compliance").closest(".stat") as HTMLElement;
    // Mean over only the row with activeGrants>0 => 100.0%, not (100+0)/2=50.0%.
    expect(card.textContent).toContain("100.0%");
    expect(card.textContent).not.toContain("50.0%");
  });

  // GAP-GRANTS-GRANTEES-03: the card counts societies+missions under an honest label.
  it("labels the society/mission count correctly and counts both", async () => {
    getGranteesMock.mockResolvedValue({
      data: [
        { ...ROW, id: "a", type: "society" as const },
        { ...ROW, id: "b", type: "mission" as const },
        { ...ROW, id: "c", type: "individual" as const },
      ],
      source: "api",
    });
    render(await GranteesPage());
    expect(screen.queryByText("NGOs")).not.toBeInTheDocument();
    const card = screen.getByText("Societies & missions").closest(".stat") as HTMLElement;
    expect(card.textContent).toContain("2");
  });
});
