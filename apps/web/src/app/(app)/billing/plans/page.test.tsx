import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
let mockRoles: string[] = ["super_admin"];

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  hasAnyRole: (roles: string[], allowed: string[]) => roles.some((r) => allowed.includes(r)),
  BILLING_PLAN_ADMIN_ROLES: ["super_admin"],
}));

import BillingPlansPage, { type PlanRow } from "./page";

function row(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    name: "Standard Monthly",
    code: "standard_monthly",
    priceMinor: "4999900",
    currency: "INR",
    govtExempt: true,
    status: "active",
    govtExemptLabel: "Yes",
    ...overrides,
  };
}

describe("BillingPlansPage (GAP-BILLING-PLANS-01/02/04/05/06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["super_admin"];
  });

  it("renders price in ₹ with grouping (PLANS-02), the code first, and no raw uuid (PLANS-04)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    const { container } = render(await BillingPlansPage());
    expect(screen.getByText("₹49,999.00")).toBeInTheDocument();
    expect(screen.getByText("standard_monthly")).toBeInTheDocument();
    expect(container.textContent).not.toContain("11111111");
  });

  it("links each row to its detail page (PLANS-01)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    render(await BillingPlansPage());
    const link = screen.getByRole("link", { name: /open standard monthly/i });
    expect(link).toHaveAttribute("href", "/billing/plans/11111111-2222-3333-4444-555555555555");
  });

  it("renders status as a pill from the active flag (PLANS-06)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row({ status: "inactive" })], source: "api" });
    render(await BillingPlansPage());
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("shows + New Plan for super_admin but not for a non-admin (PLANS-05)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    render(await BillingPlansPage());
    expect(screen.getByText("+ New Plan")).toBeInTheDocument();
  });

  it("hides + New Plan from a non-admin role (PLANS-05)", async () => {
    mockRoles = ["billing_viewer"];
    fetchJsonMock.mockResolvedValueOnce({ data: [row()], source: "api" });
    render(await BillingPlansPage());
    expect(screen.queryByText("+ New Plan")).not.toBeInTheDocument();
  });

  it("empty state shows 'Create the first plan' only for admins (PLANS-06)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });
    render(await BillingPlansPage());
    expect(screen.getByText("Create the first plan")).toBeInTheDocument();
  });

  it("a 500 shows a retryable error state, never 'No plans yet' (PLANS error path)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error", status: 500 });
    render(await BillingPlansPage());
    expect(screen.queryByText("No plans yet")).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
  });
});
