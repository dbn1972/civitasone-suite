import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-STATUTORY-NPS-03: page now has a role gate (backend
// statutory/routes.ts READER_ROLES has no "employee"/"manager" at all, so
// this page previously 403'd those roles with no explanation) -- default to
// an authorized role so the existing content tests below keep exercising
// the real page body; the dedicated gate test overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import NpsStatutoryPage from "./page";

function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ROW = {
  id: "r1",
  employeeId: "e1",
  employeeName: "Asha Rao",
  period: "2026-08",
  basicMinor: 5000000,
  empContribPct: 10,
  erContribPct: 14,
  empContribMinor: 500000,
  erContribMinor: 700000,
};

describe("NpsStatutoryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies employee/manager (not in the backend's READER_ROLES) without fetching", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    const ui = await NpsStatutoryPage();
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("shows the employee's real name instead of the raw employeeId (already returned by the backend)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await NpsStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
  });

  it("shows contribution rates with a percent sign, and relabels the base column", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await NpsStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("14%")).toBeInTheDocument();
    expect(screen.getByText("Contribution Base")).toBeInTheDocument();
  });

  it("uses a plain-language error area instead of the bare 'nps' token", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await NpsStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("We couldn't load NPS contributions.")).toBeInTheDocument();
    // The old bug: a bare, untranslated "nps" token spliced into the
    // sentence with no article/expansion (not merely a substring match
    // against the new, correct text above, which itself legitimately
    // contains "load" + "NPS").
    expect(screen.queryByText("We couldn't load nps.")).not.toBeInTheDocument();
  });

  it("no longer hard-codes percentages into the contribution-total tile labels", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await NpsStatutoryPage();
    renderPage(ui);
    expect(screen.queryByText(/Total Employee Contribution \(10%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Employer Contribution \(14%\)/)).not.toBeInTheDocument();
    expect(screen.getByText("Total Employee Contribution")).toBeInTheDocument();
  });
});
