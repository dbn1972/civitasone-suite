import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current, getSessionUserId: () => "u1" }));
vi.mock("../../../_data/loaders", () => ({
  getChartOfAccounts: async () => ({ data: [], source: "api" }),
  getFinancePendingChangeRequests: async () => ({ data: [], source: "api" }),
}));
vi.mock("./AccountsTable", () => ({ AccountsTable: (p: { canWrite?: boolean }) => <div>accounts-table canWrite={String(p.canWrite)}</div> }));
vi.mock("../_components/ChangeRequestsPanel", () => ({ ChangeRequestsPanel: () => null }));

import ChartOfAccountsPage from "./page";

// GAP-FINANCE-CHART-OF-ACCOUNTS-05
describe("ChartOfAccountsPage + Add Head role gate", () => {
  beforeEach(() => { roles.current = []; });

  it.each(["finance_officer", "finance_admin", "super_admin"])("%s sees + Add Head", async (role) => {
    roles.current = [role];
    render(await ChartOfAccountsPage());
    expect(screen.getByRole("link", { name: "+ Add Head" })).toHaveAttribute("href", "/finance/chart-of-accounts/new");
    expect(screen.getByText("accounts-table canWrite=true")).toBeInTheDocument();
  });

  it.each(["audit_officer", "budget_officer", "procurement_officer", "accounts_officer", "payroll_admin", "tenant_admin", "admin"])(
    "%s (read-only) gets no dead + Add Head button, and the table is told it cannot write",
    async (role) => {
      roles.current = [role];
      render(await ChartOfAccountsPage());
      expect(screen.queryByRole("link", { name: "+ Add Head" })).not.toBeInTheDocument();
      expect(screen.getByText("accounts-table canWrite=false")).toBeInTheDocument();
    },
  );
});
