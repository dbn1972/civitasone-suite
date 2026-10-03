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

// GAP-PAYROLL-STATUTORY-GRATUITY-01/04: the rule set comes from the tenant's rule, not a constant.
describe("GratuityPage rule set (per edition)", () => {
  const route = (rule: unknown, ruleSource = "api") => (path: string) =>
    Promise.resolve(path.includes("/gratuity/rules") ? { data: rule, source: ruleSource } : { data: [], source: "api" });

  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("a Govt Department (CCS DCRG) tenant sees the DCRG subtitle, ceiling and calculator wording, not the Payment of Gratuity Act", async () => {
    fetchJsonMock.mockImplementation(route({ ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: "250000000", source: "tenant" }));
    renderPage(await GratuityPage());
    expect(screen.getByText(/Death-cum-retirement gratuity \(DCRG\)/)).toBeInTheDocument();
    expect(screen.getByText(/DCRG ceiling in force: ₹25,00,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/Government DCRG under the CCS \(Pension\) Rules/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment of Gratuity Act ceiling/)).not.toBeInTheDocument();
  });

  it("with the default rule it keeps the Payment of Gratuity Act wording and the Rs 20 lakh ceiling", async () => {
    fetchJsonMock.mockImplementation(route({ ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: "200000000", source: "default" }));
    renderPage(await GratuityPage());
    expect(screen.getByText(/Payment of Gratuity Act ceiling: ₹20,00,000.00/)).toBeInTheDocument();
  });

  it("a rule that cannot be loaded falls back to the default AND says so", async () => {
    fetchJsonMock.mockImplementation(route({ ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: "200000000", source: "default" }, "error"));
    renderPage(await GratuityPage());
    expect(screen.getByText(/Could not load this organisation's gratuity rule/)).toBeInTheDocument();
  });

  it("only payroll_admin / super_admin get the rule-set form", async () => {
    fetchJsonMock.mockImplementation(route({ ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: "200000000", source: "default" }));
    renderPage(await GratuityPage());
    expect(screen.getByText("Gratuity rule set")).toBeInTheDocument();
  });

  it("an officer reads the register but gets no rule-set form", async () => {
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    fetchJsonMock.mockImplementation(route({ ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: "200000000", source: "default" }));
    renderPage(await GratuityPage());
    expect(screen.queryByText("Gratuity rule set")).not.toBeInTheDocument();
  });
});
