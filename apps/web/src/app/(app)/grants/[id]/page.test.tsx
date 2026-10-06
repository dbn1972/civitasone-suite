import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const getGrantByIdMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantById: (id: string) => getGrantByIdMock(id),
}));

const rolesMock = vi.fn(() => ["grant_officer"]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

import GrantDetailPage from "./page";

const GRANT = {
  id: "grant-1",
  grantNo: "GNT-2026-27-00001",
  title: "Community water supply project",
  grantor: "Ministry of Jal Shakti",
  granteeName: "Gram Panchayat Alpha",
  totalAmount: 45000,
  disbursedAmount: 10000,
  pendingAmount: 35000,
  sanctionDate: "2026-08-12",
  status: "active",
  installments: [],
  ucs: [],
};

describe("GrantDetailPage", () => {
  beforeEach(() => {
    getGrantByIdMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantByIdMock.mockResolvedValue({ data: GRANT, source: "api" });
  });

  it("renders exactly one breadcrumb back-link to /grants/list, not two", async () => {
    render(await GrantDetailPage({ params: { id: "grant-1" } }));

    const backLinks = screen.getAllByRole("link", { name: "All grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/list");

    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await GrantDetailPage({ params: { id: "grant-1" } }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Community water supply project" })
    ).toBeInTheDocument();
  });

  // GAP-GRANTS-DETAIL-02: a failed fetch (source==="error", not a real 404)
  // renders the retry state, NOT notFound().
  it("renders a retry state on a failed fetch instead of calling notFound", async () => {
    getGrantByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const page = await GrantDetailPage({ params: { id: "grant-1" } });
    render(page);
    // RefreshErrorState renders a Retry/Try again control; notFound() would have thrown.
    expect(screen.getAllByText(/try again|couldn't load|couldn’t load|retry/i).length).toBeGreaterThan(0);
  });

  // GAP-GRANTS-DETAIL-02: a genuine 404 (or successful null) still calls notFound().
  it("calls notFound for a genuine 404", async () => {
    getGrantByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(GrantDetailPage({ params: { id: "grant-1" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound for a successful null (api source)", async () => {
    getGrantByIdMock.mockResolvedValue({ data: null, source: "api" });
    await expect(GrantDetailPage({ params: { id: "grant-1" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
