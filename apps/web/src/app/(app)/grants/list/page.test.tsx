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

const getGrantsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrants: () => getGrantsMock(),
}));

import GrantsListPage from "./page";

const ROW = {
  id: "grant-1",
  grantNo: "GR-2026-04",
  title: "Water supply",
  granteeName: "District Panchayat",
  totalAmount: 1000000,
  disbursedAmount: 400000,
  pendingAmount: 600000,
  sanctionDate: "2026-08-12",
  status: "active" as const,
};

describe("GrantsListPage", () => {
  beforeEach(() => {
    getGrantsMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantsMock.mockResolvedValue({ data: [ROW], source: "api" });
  });

  // GAP-GRANTS-LIST-01: failed empty load shows retry, not "Total 0".
  it("shows a retry/error state on a failed empty load", async () => {
    getGrantsMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrantsListPage());
    expect(screen.getByText(/couldn't load grants/i)).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-LIST-01: a legitimately empty tenant is NOT an error state.
  it("shows zero stats (not an error) on an empty successful load", async () => {
    getGrantsMock.mockResolvedValue({ data: [], source: "api" });
    render(await GrantsListPage());
    expect(screen.queryByText(/couldn't load grants/i)).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  // GAP-GRANTS-LIST-04: exactly one breadcrumb back-link via PageHeader (no manual nav).
  it("renders exactly one PageHeader back link, no manual breadcrumb nav", async () => {
    render(await GrantsListPage());
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  // GAP-GRANTS-LIST-02: an "As of" timestamp is shown next to the stats.
  it("shows an 'As of' timestamp", async () => {
    render(await GrantsListPage());
    expect(screen.getByText(/^As of /)).toBeInTheDocument();
  });
});
