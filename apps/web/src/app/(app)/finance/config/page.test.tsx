import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
const rolesMock = vi.fn(() => ["finance_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import FinanceConfigPage from "./page";

const FY = { id: "f1", code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" };
const BANK = { id: "b1", bankName: "State Bank of India", branchName: "Sansad Marg", accountNoLast4: "1234", ifscPrefix: "SBINXXXXXXX", accountType: "current", purpose: null, status: "active" };

function respond(fy: unknown, bank: unknown) {
  fetchJsonMock.mockImplementation(async (url: string) => (String(url).includes("bank-accounts") ? bank : fy));
}

describe("FinanceConfigPage (GAP-FINANCE-CONFIG-01/-02)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReturnValue(["finance_admin"]); });

  it("never instructs the user to call the API; links to the real screens", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    const { container } = render(await FinanceConfigPage());
    expect(container.textContent).not.toMatch(/POST \/v1|Use the API|coming soon/i);
    expect(screen.getByRole("link", { name: "Manage fiscal years" })).toHaveAttribute("href", "/finance/fiscal-years");
    expect(screen.getByRole("link", { name: "Enter opening balances" })).toHaveAttribute("href", "/finance/opening-balances?fy=2026-27");
  });

  it("shows only the masked account number", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
  });

  it("offers the add-bank form to finance_admin, not to other finance roles", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByRole("button", { name: "Add bank account" })).toBeInTheDocument();
  });

  it("an audit_officer (bank list 403) still sees fiscal years, and no add-bank form", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    respond({ data: [FY], source: "api" }, { data: [], source: "error", status: 403 });
    render(await FinanceConfigPage());
    expect(screen.getAllByText("2026-27").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add bank account" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CONFIG-03 (already implemented on main; pinned here)
  it("on a failed load the stat cards read a dash, not 'Not set' or 0", async () => {
    respond({ data: [], source: "error", status: 500 }, { data: [], source: "error", status: 500 });
    render(await FinanceConfigPage());
    expect(screen.getByText("Active FY").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Bank Accounts", { selector: ".lab" }).closest(".stat")).toHaveTextContent("—");
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  it("a successful load with no active year still says 'Not set'", async () => {
    respond({ data: [{ ...FY, status: "draft" }], source: "api" }, { data: [], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("Active FY").closest(".stat")).toHaveTextContent("Not set");
  });

  // GAP-FINANCE-CONFIG-04
  it("renders financial-year dates in the Indian format, not the raw ISO string", async () => {
    respond({ data: [FY], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("01 Apr 2026")).toBeInTheDocument();
    expect(screen.getByText("31 Mar 2027")).toBeInTheDocument();
    expect(screen.queryByText("2026-04-01")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-CONFIG-06
  it("keeps the Opening Balances card visible without an active year, disabled with a hint", async () => {
    respond({ data: [{ ...FY, status: "draft" }], source: "api" }, { data: [BANK], source: "api" });
    render(await FinanceConfigPage());
    expect(screen.getByText("Opening Balances")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter opening balances" })).not.toBeInTheDocument();
    expect(screen.getByText(/Activate a financial year first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter opening balances" })).toBeDisabled();
  });
});
