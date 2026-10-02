import { describe, it, expect, vi, beforeEach } from "vitest";
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import StatutoryHubPage from "./page";

// The "Statutory Compliance Summary" cards above the module directory are
// themselves full-card links to the same consoles the directory tiles below
// link to (e.g. both an "ESI" summary card AND an "ESI" directory tile point
// at /hr/payroll/statutory/esi) -- two legitimate paths to the same
// destination, not a bug, but it means a plain getByRole("link", {name})
// query can match more than one element for ESI/GPF/NPS specifically
// (the three labels that are spelled identically in both places). Assert
// that a link with the expected accessible name AND href exists, rather
// than requiring exactly one match.
function expectSomeLinkTo(name: RegExp, href: string) {
  const matches = screen.getAllByRole("link", { name });
  expect(matches.some((el) => el.getAttribute("href") === href)).toBe(true);
}

describe("StatutoryHubPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("shows PermissionDenied to employee/manager instead of the hub (GAP-PAYROLL-STATUTORY-04)", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await StatutoryHubPage();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /PF & ECR/ })).not.toBeInTheDocument();
  });

  it("admits a read-only statutory role (finance_officer) (GAP-PAYROLL-STATUTORY-04)", async () => {
    getSessionRolesMock.mockReturnValue(["finance_officer"]);
    const ui = await StatutoryHubPage();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>,
    );
    expectSomeLinkTo(/PF & ECR/, "/hr/payroll/statutory/pf");
  });

  it("renders links to every statutory console", async () => {
    // UX-017: StatutoryHubPage now reads its copy through
    // getTranslations("statutory") and is an async Server Component --
    // render its resolved element, same pattern as GratuityPage.test.tsx.
    // It also renders StatutoryComplianceCard, a "use client" component
    // that calls useTranslations("statutoryComplianceCard"), so this render
    // needs a real NextIntlClientProvider in the tree too.
    const ui = await StatutoryHubPage();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>,
    );
    expectSomeLinkTo(/PF & ECR/, "/hr/payroll/statutory/pf");
    expectSomeLinkTo(/\bESI\b/, "/hr/payroll/statutory/esi");
    expectSomeLinkTo(/Professional Tax/, "/hr/payroll/statutory/pt");
    expectSomeLinkTo(/Labour Welfare Fund/, "/hr/payroll/statutory/lwf");
    expectSomeLinkTo(/Gratuity/, "/hr/payroll/statutory/gratuity");
    expectSomeLinkTo(/Challans/, "/hr/payroll/statutory/challans");
    expectSomeLinkTo(/Perquisites/, "/hr/payroll/statutory/perquisite");
    expectSomeLinkTo(/\bGPF\b/, "/hr/payroll/gpf");
    expectSomeLinkTo(/\bNPS\b/, "/hr/payroll/nps");
  });

  it("GAP-PAYROLL-STATUTORY-01 / LWF-04: PT, LWF and GPF cards show no percentage or 15th due date; PF/ESI keep both", async () => {
    const ui = await StatutoryHubPage();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {ui}
      </NextIntlClientProvider>,
    );
    const cards = Array.from(document.querySelectorAll("a.statutory-card")) as HTMLElement[];
    const byHref = (h: string) => cards.find((c) => c.getAttribute("href") === h) as HTMLElement;
    for (const href of ["/hr/payroll/statutory/pt", "/hr/payroll/statutory/lwf", "/hr/payroll/gpf"]) {
      expect(byHref(href).textContent).not.toMatch(/%/);
      expect(byHref(href).textContent).not.toMatch(/Challan due/);
    }
    expect(byHref("/hr/payroll/statutory/lwf").textContent).toMatch(/vary by state/);
    expect(byHref("/hr/payroll/statutory/pf").textContent).toMatch(/12%/);
    expect(byHref("/hr/payroll/statutory/pf").textContent).toMatch(/Challan due/);
    expect(byHref("/hr/payroll/statutory/esi").textContent).toMatch(/3\.25%/);
    // NPS keeps its rates but has no challan due day.
    expect(byHref("/hr/payroll/nps").textContent).not.toMatch(/Challan due/);
    expect(screen.getByText(/statutory reference values \(as of Aug 2026\)/)).toBeInTheDocument();
  });
});
