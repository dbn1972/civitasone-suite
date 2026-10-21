import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));

import AddHeadLayout from "./layout";

// GAP-FINANCE-CHART-OF-ACCOUNTS-05: POST/PATCH /v1/finance/accounts admit only finance_officer, finance_admin, super_admin.
describe("chart-of-accounts/new role gate (GAP-FINANCE-CHART-OF-ACCOUNTS-05)", () => {
  beforeEach(() => { roles.current = []; });

  it.each(["finance_officer", "finance_admin", "super_admin"])("%s gets the form", (role) => {
    roles.current = [role];
    render(<AddHeadLayout><p>head form</p></AddHeadLayout>);
    expect(screen.getByText("head form")).toBeInTheDocument();
  });

  it.each(["audit_officer", "budget_officer", "procurement_officer", "accounts_officer", "payroll_admin", "tenant_admin", "admin"])(
    "%s (a read-only finance role) gets the access-restricted card, not the form",
    (role) => {
      roles.current = [role];
      render(<AddHeadLayout><p>head form</p></AddHeadLayout>);
      expect(screen.queryByText("head form")).not.toBeInTheDocument();
      expect(screen.getByText("Access restricted")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Chart of Accounts" })).toHaveAttribute("href", "/finance/chart-of-accounts");
    },
  );

  it("a session with no roles at all gets no form (the service would refuse it anyway)", () => {
    render(<AddHeadLayout><p>head form</p></AddHeadLayout>);
    expect(screen.queryByText("head form")).not.toBeInTheDocument();
  });

  it("one writer role among others is enough", () => {
    roles.current = ["audit_officer", "finance_officer"];
    render(<AddHeadLayout><p>head form</p></AddHeadLayout>);
    expect(screen.getByText("head form")).toBeInTheDocument();
  });
});
