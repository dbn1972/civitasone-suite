import { describe, it, expect, vi, beforeEach } from "vitest";

// Role gate (see the page's own GAP comment): default every test to an
// authorized payroll role; the gate tests below override per call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GratuityPage from "./page";

// UX-017: GratuityPage (Server Component, getTranslations("gratuity")) also
// renders GratuityCalculator, a "use client" component that calls
// useTranslations("gratuityCalculator") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("GratuityPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders the gratuity register", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", yearsOfService: "12.50", gratuityMinor: 500000, status: "computed" }],
      source: "api",
    });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no gratuity records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("No gratuity records")).toBeInTheDocument();
  });

  it("shows the error state — not the honest-empty prompt — when the loader errors", async () => {
    // UX-013: replaces the old floating "Couldn't load — showing nothing"
    // badge, which coexisted with (and never gated) the register's own
    // .length === 0 check below it — a real outage and a tenant with zero
    // gratuity records rendered the same "No gratuity records" prompt.
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("We couldn't load gratuity records.")).toBeInTheDocument();
    expect(screen.queryByText("No gratuity records")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-GRATUITY-02: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-GRATUITY-06: shows the employee name the API returns instead of the raw id", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", employeeName: "Meena Iyer", yearsOfService: "22.00", gratuityMinor: 500000, status: "computed" }],
      source: "api",
    });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("Meena Iyer")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-GRATUITY-06: flags a failed register load with the DataSourceBadge", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText(/couldn.t load the gratuity register/i)).toBeInTheDocument();
  });
});
