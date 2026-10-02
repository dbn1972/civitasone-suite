import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => (key === "subtitle" ? "translated-subtitle" : key),
}));
const pathnameMock = vi.hoisted(() => vi.fn(() => "/finance"));
vi.mock("next/navigation", () => ({ usePathname: pathnameMock, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import FinanceHub from "./page";
import FinanceLoading from "./loading";

describe("finance hub tiles (GAP-FINANCE-HOME-01/02/03/04)", () => {
  it("HOME-01: there is a single PFMS tile (main's decision), in Treasury & Banking, pointing at /finance/pfms", async () => {
    render(await FinanceHub());
    const pfms = screen.getAllByRole("link").filter((l) => /PFMS/.test(l.textContent ?? ""));
    expect(pfms).toHaveLength(1);
    expect(pfms[0]).toHaveAttribute("href", "/finance/pfms");
    const treasury = screen.getByRole("heading", { name: "Treasury & Banking" }).parentElement!;
    expect(treasury.querySelector('a[href="/finance/pfms"]')).not.toBeNull();
  });

  it("HOME-02: Debt Management and Reconciliation are under Treasury & Banking with unchanged hrefs", async () => {
    render(await FinanceHub());
    const treasury = screen.getByRole("heading", { name: "Treasury & Banking" }).parentElement!;
    const links = Array.from(treasury.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links.map((l) => l[1])).toEqual(expect.arrayContaining(["/finance/debt", "/finance/reconciliation", "/finance/pfms"]));
    const audit = screen.getByRole("heading", { name: "Audit & Compliance" }).parentElement!;
    expect(audit.querySelector('a[href="/finance/debt"]')).toBeNull();
    const statutory = screen.getByRole("heading", { name: "Statutory" }).parentElement!;
    expect(statutory.querySelector('a[href="/finance/reconciliation"]')).toBeNull();
    expect(statutory.querySelector('a[href="/finance/pfms"]')).toBeNull();
  });

  it("HOME-03: Finance Configuration is reachable from the hub", async () => {
    render(await FinanceHub());
    expect(screen.getByRole("link", { name: /Finance Configuration/ })).toHaveAttribute("href", "/finance/config");
  });

  it("HOME-04: the subtitle comes from next-intl, not a hard-coded literal", async () => {
    render(await FinanceHub());
    expect(screen.getByText("translated-subtitle")).toBeInTheDocument();
    expect(screen.queryByText(/Ledgers, budgets, expenditure/)).not.toBeInTheDocument();
  });
});

describe("finance loading fallback (GAP-FINANCE-HOME-05)", () => {
  it("/finance gets a tile-shaped skeleton (no stat-card table block)", () => {
    pathnameMock.mockReturnValue("/finance");
    render(<FinanceLoading />);
    expect(screen.getByRole("status", { name: "Loading finance hub…" })).toBeInTheDocument();
  });
  it("a child route without its own loading.tsx keeps the generic fallback", () => {
    pathnameMock.mockReturnValue("/finance/audit-paras");
    render(<FinanceLoading />);
    expect(screen.getByRole("status", { name: "Loading finance section…" })).toBeInTheDocument();
  });
});
