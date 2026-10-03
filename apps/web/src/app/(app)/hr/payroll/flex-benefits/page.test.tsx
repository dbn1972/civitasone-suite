import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
let sessionRoles: string[] = ["employee"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => sessionRoles,
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import FlexBenefitsPage from "./page";

const PLAN_ROW = {
  id: "p1", name: "Standard Flex", fy: "2026-27", total_budget_minor: "5000000", status: "active",
  components: [{ name: "Medical", maxMinor: 2000000, taxExempt: true }],
};

const NO_PENDING = { data: { rows: [], total: 0 }, source: "api" };

function withData(
  elections: { data: unknown; source: string },
  plans: { data: unknown; source: string } = { data: [PLAN_ROW], source: "api" },
  pending: { data: unknown; source: string } = NO_PENDING,
) {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/payroll/flex-benefits/plans")) return Promise.resolve(plans);
    if (path.startsWith("/api/v1/payroll/flex-benefits/elections")) return Promise.resolve(pending);
    return Promise.resolve(elections);
  });
}

async function renderPage() {
  const ui = await FlexBenefitsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("FlexBenefitsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    sessionRoles = ["employee"];
  });

  it("renders the list of elections", async () => {
    withData({
      data: [{ id: "el1", plan_id: "p1", plan_name: "FY26 Flex Plan", fy: "2025-26", total_elected_minor: 500000, status: "submitted" }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("FY26 Flex Plan")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-04: lists the available plans", async () => {
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("Available Plans")).toBeInTheDocument();
    expect(screen.getByText("Medical (≤ ₹20,000.00)")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-02: an employee gets the election form and no plan form", async () => {
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("Elect Flex Benefit Components")).toBeInTheDocument();
    expect(screen.queryByText("Create Flex Benefit Plan")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-02: payroll_admin gets the plan form", async () => {
    sessionRoles = ["payroll_admin"];
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("Create Flex Benefit Plan")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-02: a manager-only account gets Access restricted and no fetch", async () => {
    sessionRoles = ["manager"];
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-04: the employee empty state does not send them to an admin form", async () => {
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No flex benefit elections yet")).toBeInTheDocument();
    expect(screen.queryByText(/Create a plan/)).not.toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    withData({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-05: a payroll admin sees the approval queue with the employee name", async () => {
    sessionRoles = ["payroll_admin"];
    withData({ data: [], source: "api" }, undefined, {
      source: "api",
      data: { total: 1, rows: [{ id: "e1", employeeName: "Asha Verma", planName: "Standard Flex", fy: "2026-27", totalElectedMinor: "150000", status: "submitted", etag: "c", isOwnSubmission: false }] },
    });
    await renderPage();
    expect(screen.getByText("Elections Awaiting Approval")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-05: a failed queue load shows an error state, not an empty queue", async () => {
    sessionRoles = ["payroll_admin"];
    withData({ data: [], source: "api" }, undefined, { source: "error", data: { rows: [], total: 0 } });
    await renderPage();
    expect(screen.queryByText("No flex benefit elections are waiting for approval.")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-FLEX-BENEFITS-05: an employee never loads or sees the approval queue", async () => {
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByText("Elections Awaiting Approval")).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]).includes("/flex-benefits/elections"))).toBe(false);
  });
});
