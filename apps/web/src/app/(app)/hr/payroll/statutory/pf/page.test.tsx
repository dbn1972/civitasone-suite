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

import PfStatutoryPage from "./page";

// UX-017: PfStatutoryPage (Server Component, getTranslations("pf")) also
// renders EcrGeneratorForm, a "use client" component that calls
// useTranslations("ecrGeneratorForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PfStatutoryPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders the PF ledger", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", basicMinor: 5000000, empContribMinor: 600000, erContribMinor: 600000 }],
      source: "api",
    });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PF records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("No PF records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-PF-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-PF-01: a read-only role (hr_admin) sees the ledger but not the write form", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.queryByText("Generate EPFO ECR File")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-PF-01: a payroll role sees the write form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("Generate EPFO ECR File")).toBeInTheDocument();
  });
});
