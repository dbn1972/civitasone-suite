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
});
