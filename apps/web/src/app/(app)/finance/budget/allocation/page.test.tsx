import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getBudgets = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/app/_data/loaders", () => ({
  getFinanceAllocations: vi.fn(async () => ({
    source: "api",
    status: 200,
    data: [
      { id: "a1", headId: "h1", fy: "2026-27", allocatedMinor: "100", committedMinor: "50", actualMinor: "0", availableMinor: "50" },
      { id: "a2", headId: "h2", fy: "2026-27", allocatedMinor: "100", committedMinor: "0", actualMinor: "0", availableMinor: "100" },
    ],
  })),
  getFinanceBudgetsForReappropriation: (...a: unknown[]) => getBudgets(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => session.roles }));
vi.mock("./AllocationTable", () => ({ AllocationTable: () => <div>table</div> }));
vi.mock("./ReappropriateWithApproval", () => ({
  ReappropriateWithApproval: (p: { allocations: { id: string; label: string; availableMinor: string }[] }) => (
    <div>reappropriate-control {p.allocations.map((a) => `${a.id}|${a.label}|${a.availableMinor}`).join(";")}</div>
  ),
}));

import AllocationPage from "./page";

describe("AllocationPage copy (GAP-FINANCE-BUDGET-ALLOCATION-04)", () => {
  beforeEach(() => { session.roles = ["audit_officer"]; getBudgets.mockReset(); });

  it("does not promise release / department-wise and labels the zero-commitment card by meaning", async () => {
    render(await AllocationPage());
    expect(screen.getByText(/by budget head and financial year/)).toBeInTheDocument();
    expect(screen.queryByText(/release/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/department-wise/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByText("Not yet committed").closest(".stat")).toHaveTextContent("1");
  });
});

describe("AllocationPage re-appropriation (GAP-FINANCE-BUDGET-ALLOCATION-03)", () => {
  beforeEach(() => { getBudgets.mockReset(); });

  it("wires the control for permitted roles, fed from the finance BUDGETS (not allocation ids)", async () => {
    session.roles = ["finance_officer"];
    getBudgets.mockResolvedValue({
      source: "api",
      data: [{ id: "bud-1", majorHead: "3054 Roads", subHead: "NH", financialYear: "2026-27", balance: "250000" }],
    });
    render(await AllocationPage());
    expect(screen.getByText(/reappropriate-control bud-1\|3054 Roads · NH · FY 2026-27\|250000/)).toBeInTheDocument();
  });

  it("is not offered to a read-only role, and the budgets are not even fetched for them", async () => {
    session.roles = ["audit_officer"];
    render(await AllocationPage());
    expect(screen.queryByText(/reappropriate-control/)).not.toBeInTheDocument();
    expect(getBudgets).not.toHaveBeenCalled();
  });

  it("when the budget list cannot be loaded it says so instead of offering an empty picker", async () => {
    session.roles = ["finance_admin"];
    getBudgets.mockResolvedValue({ source: "error", status: 503, data: [] });
    render(await AllocationPage());
    expect(screen.queryByText(/reappropriate-control/)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/budget list could not be loaded/i);
  });
});
