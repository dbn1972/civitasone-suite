import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
const loaderMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceBills: () => loaderMock() }));
vi.mock("./BillsTable", () => ({ BillsTable: () => <div>bills-table</div> }));

import BillsPage from "./page";

describe("BillsPage header actions", () => {
  beforeEach(() => {
    rolesMock.mockReset();
    loaderMock.mockResolvedValue({ data: [], source: "api" });
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-05
  it("hides + New Bill from a read-only finance reader (audit_officer)", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    render(await BillsPage());
    expect(screen.queryByRole("link", { name: /new bill/i })).not.toBeInTheDocument();
  });

  it("offers + New Bill to finance_officer", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    render(await BillsPage());
    expect(screen.getByRole("link", { name: /new bill/i })).toHaveAttribute("href", "/finance/expenditure/bills/new");
  });

  it("does not hide it when the session carries no role claim (server decides)", async () => {
    rolesMock.mockReturnValue([]);
    render(await BillsPage());
    expect(screen.getByRole("link", { name: /new bill/i })).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-04
  it("no longer shows a Finance Configuration link beside the primary action", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    render(await BillsPage());
    expect(screen.queryByRole("link", { name: /finance configuration/i })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-03 (already fixed by #1786): regression guard.
  it("a failed load shows dashes, not zeros, and no table", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await BillsPage());
    expect(screen.queryByText("bills-table")).not.toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
