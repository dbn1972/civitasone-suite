/**
 * M9: the disbursement page shows the export-only ledger panel only for a
 * tenant in export mode. Every other answer from the ledger-mode endpoint
 * leaves the page exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["payroll_admin"],
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
}));
vi.mock("@/lib/entityAdapters/payrollEmployee", () => ({
  searchPayrollEmployees: vi.fn(async () => []),
  resolvePayrollEmployees: vi.fn(async () => []),
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...args: unknown[]) => fetchJsonMock(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import DisbursementPage from "./page";

function respond(ledger: unknown) {
  fetchJsonMock.mockImplementation((path: string, fallback: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) => {
    if (path.includes("ledger-mode")) {
      // Run the page's own mapper over the raw body so the test covers it too.
      const mapped = ledger === "error" ? fallback : (opts?.mapResponse?.(ledger) ?? fallback);
      return Promise.resolve({ data: mapped, source: ledger === "error" ? "error" : "api" });
    }
    if (path.includes("/runs")) return Promise.resolve({ data: [{ id: "r1", payPeriod: "2026-07", employeeCount: 3, grossAmount: 1, netAmount: 1, status: "paid" }], source: "api" });
    return Promise.resolve({ data: path.includes("sponsor") || path.includes("dsc") || path.includes("signing") ? null : [], source: "api" });
  });
}

async function renderPage() {
  const ui = await DisbursementPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("DisbursementPage: payroll without Finance panel", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("shows the panel for a tenant in export mode", async () => {
    respond({ mode: "export", source: "derived", override: null, hasFinance: false });
    await renderPage();
    expect(screen.getByText("Payroll without Finance")).toBeInTheDocument();
    expect(screen.getByText("Download CSV")).toBeInTheDocument();
  });

  it.each([
    ["a finance tenant", { mode: "finance", source: "derived", override: null, hasFinance: true }],
    ["an unreadable answer", "error"],
    ["an empty body", []],
    ["a payroll-service without the endpoint", null],
  ])("does not show it for %s", async (_label, ledger) => {
    respond(ledger);
    await renderPage();
    expect(screen.queryByText("Payroll without Finance")).toBeNull();
    expect(screen.queryByText("Download CSV")).toBeNull();
  });
});
