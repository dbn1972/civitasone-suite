import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// GAP-GRANTS-SCHEMES-01: the page now reads session roles server-side to decide
// whether to offer the maker-only "+ New Scheme" action. Mock the guard so the
// test controls the roles without a real request/cookie scope.
const rolesMock = vi.fn(() => ["grant_officer"] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

const getGrantSchemesMock = vi.fn();
vi.mock("../_data", () => ({
  getGrantSchemes: () => getGrantSchemesMock(),
}));

import GrantSchemesPage from "./page";

const BASE_ROW = {
  id: "scheme-1",
  code: "PM-KISAN-2026",
  name: "PM Farmer Support Scheme",
  budgetMinor: 100000000,
  disbursedMinor: 25000000,
  currency: "INR",
  status: "open",
  openAt: "2026-04-01",
  closeAt: "2027-03-31",
  applicationCount: 12,
};

describe("GrantSchemesPage", () => {
  beforeEach(() => {
    getGrantSchemesMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantSchemesMock.mockResolvedValue({ data: [BASE_ROW], source: "api", droppedCount: 0 });
  });

  it("renders exactly one breadcrumb back-link to /grants, not two", async () => {
    render(await GrantSchemesPage());

    const backLinks = screen.getAllByRole("link", { name: "Grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants");

    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await GrantSchemesPage());
    expect(screen.getByRole("heading", { level: 1, name: "Grant Schemes" })).toBeInTheDocument();
  });

  // GAP-GRANTS-SCHEMES-01
  it("shows '+ New Scheme' for a maker role", async () => {
    rolesMock.mockReturnValue(["grant_admin"]);
    render(await GrantSchemesPage());
    expect(screen.getByRole("link", { name: "+ New Scheme" })).toBeInTheDocument();
  });

  it("hides '+ New Scheme' for a read-only role", async () => {
    rolesMock.mockReturnValue(["grant_viewer"]);
    render(await GrantSchemesPage());
    expect(screen.queryByRole("link", { name: "+ New Scheme" })).not.toBeInTheDocument();
  });

  // GAP-GRANTS-SCHEMES-03: Total Budget sums only sanctioned statuses.
  it("Total Budget excludes draft/cancelled schemes", async () => {
    getGrantSchemesMock.mockResolvedValue({
      data: [
        { ...BASE_ROW, id: "a", status: "open", budgetMinor: 10000 },
        { ...BASE_ROW, id: "b", status: "cancelled", budgetMinor: 5000 },
        { ...BASE_ROW, id: "c", status: "draft", budgetMinor: 7000 },
      ],
      source: "api",
      droppedCount: 0,
    });
    render(await GrantSchemesPage());
    // Total Budget stat card = sanctioned only (open 10000 paise => ₹100.00);
    // the cancelled/draft budgets must not be added (would be ₹220.00).
    const budgetCard = screen.getByText("Total Budget (sanctioned)").closest(".stat") as HTMLElement;
    expect(budgetCard).toBeTruthy();
    expect(budgetCard.textContent).toContain("₹100.00");
    expect(budgetCard.textContent).not.toContain("₹220.00");
  });

  // GAP-GRANTS-SCHEMES-02: a failed load shows "—" stats, no fabricated 0.
  it("renders '—' stat cards and hides New Scheme on a failed load", async () => {
    getGrantSchemesMock.mockResolvedValue({ data: [], source: "error", droppedCount: 0 });
    render(await GrantSchemesPage());
    expect(screen.queryByRole("link", { name: "+ New Scheme" })).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-GRANTS-SCHEMES-04: Applications stat is "—" when every row's count is null.
  it("shows '—' for Applications when counts are unknown", async () => {
    getGrantSchemesMock.mockResolvedValue({
      data: [{ ...BASE_ROW, applicationCount: null }],
      source: "api",
      droppedCount: 0,
    });
    render(await GrantSchemesPage());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-GRANTS-SCHEMES-05: dropped rows are surfaced.
  it("warns when rows were dropped as incomplete", async () => {
    getGrantSchemesMock.mockResolvedValue({ data: [BASE_ROW], source: "api", droppedCount: 2 });
    render(await GrantSchemesPage());
    expect(screen.getByText(/could not be displayed/i)).toBeInTheDocument();
  });
});
