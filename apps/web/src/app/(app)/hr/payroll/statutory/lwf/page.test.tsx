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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LwfPage from "./page";

// UX-017: LwfPage (Server Component, getTranslations("lwf")) also renders
// LwfConfigForm, a "use client" component that calls
// useTranslations("lwfConfigForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("LwfPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ state_code: "KA", employee_contrib_minor: 2000, employer_contrib_minor: 2000, frequency: "yearly" }],
      source: "api",
    });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there is no LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText("No LWF configuration")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-01: a read-only role (hr_admin) sees the ledger but not the write form", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.queryByText("Add / Update LWF Configuration")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-01: a payroll role sees the write form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText("Add / Update LWF Configuration")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-LWF-03/06: labels the frequency enum and splits monthly vs other states", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { state_code: "KA", employee_contrib_minor: 2000, employer_contrib_minor: 4000, frequency: "yearly" },
        { state_code: "MH", employee_contrib_minor: 1200, employer_contrib_minor: 3600, frequency: "half_yearly" },
        { state_code: "TN", employee_contrib_minor: 500, employer_contrib_minor: 1000, frequency: "monthly" },
      ],
      source: "api",
    });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getAllByText("Yearly").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Half-yearly").length).toBeGreaterThan(0);
    expect(screen.queryByText("half_yearly")).not.toBeInTheDocument();
    expect(screen.getByText("Monthly frequency states")).toBeInTheDocument();
    expect(screen.getByText("Other frequency states")).toBeInTheDocument();
  });
});
